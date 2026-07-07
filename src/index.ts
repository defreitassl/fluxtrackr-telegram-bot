import https from 'node:https';
import { Context, Markup, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import {
  ApiClient,
  ApiConnectionError,
  ApiError,
  ApiResponseError,
  Category,
  Transaction,
  TransactionType,
} from './api';
import { loadConfig } from './config';
import { logError, logInfo, logWarn } from './logger';
import {
  parseLooseTransactionMessage,
  parseTransactionMessage,
} from './parser';

const PENDING_TRANSACTION_TTL_MS = 10 * 60 * 1000;
const CHAT_SESSION_RESET_MS = 24 * 60 * 60 * 1000;
const MENU_BUTTONS = {
  addTransaction: 'Lancar transacao',
  summary: 'Resumo',
  categories: 'Categorias',
  cancel: 'Cancelar',
  help: 'Ajuda',
} as const;

type PendingTransaction = {
  id: string;
  amount: number;
  description: string;
  categories: Category[];
  createdAt: number;
  type?: TransactionType;
};

type ChatSession = {
  lastInteractionAt: number;
};

type ReplyableContext = Pick<Context, 'reply'> & {
  from: { id: number };
};

type EditableContext = ReplyableContext & Pick<Context, 'editMessageText'>;

type BotContext = Context & {
  from: { id: number };
};

const config = loadConfig();
const api = new ApiClient({
  apiBaseUrl: config.apiBaseUrl,
  email: config.botUserEmail,
  password: config.botUserPassword,
});
const bot = new Telegraf(config.telegramBotToken, {
  telegram: {
    agent: new https.Agent({
      family: 4,
      keepAlive: true,
    }),
  },
});
const pendingTransactions = new Map<number, PendingTransaction>();
const chatSessions = new Map<number, ChatSession>();

function isAuthorized(userId: number | undefined) {
  return userId === config.telegramUserId;
}

function startsWithKnownTypeCommand(text: string) {
  const [command] = text.trim().split(/\s+/);
  return ['gasto', 'receita'].includes(command?.toLowerCase() ?? '');
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    [MENU_BUTTONS.addTransaction],
    [MENU_BUTTONS.summary, MENU_BUTTONS.categories],
    [MENU_BUTTONS.cancel, MENU_BUTTONS.help],
  ])
    .resize()
    .persistent();
}

function startText() {
  return [
    'FluxTrackr pronto.',
    'Envie uma transacao como: gasto 32.90 almoco alimentacao',
    'Ou use o menu abaixo.',
  ].join('\n');
}

function helpText() {
  return [
    'Exemplos:',
    'gasto 32.90 almoco alimentacao',
    'receita 1200 freela trabalho',
    '32.90 almoco',
    '',
    'Comandos:',
    '/resumo - resumo do mes atual',
    '/categorias - listar categorias cadastradas',
    '/cancelar - cancelar uma operacao guiada',
    '/menu - mostrar o menu principal',
  ].join('\n');
}

function transactionPromptText() {
  return [
    'Envie a transacao em uma mensagem.',
    '',
    'Exemplos:',
    'gasto 32.90 almoco alimentacao',
    'receita 1200 freela trabalho',
    '32.90 almoco',
  ].join('\n');
}

function getUserErrorMessage(error: unknown) {
  if (error instanceof ApiConnectionError) {
    return 'A API local nao respondeu agora. Confira se ela esta rodando em API_BASE_URL.';
  }

  if (error instanceof ApiResponseError) {
    return 'A API respondeu em um formato inesperado. Tente novamente em instantes.';
  }

  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'Nao consegui autenticar na API. Confira BOT_USER_EMAIL e BOT_USER_PASSWORD.';
    }

    if (error.status === 400) {
      return `A API recusou os dados: ${error.message}`;
    }

    if (error.status >= 500) {
      return 'A API teve um erro interno. Tente novamente em instantes.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Nao consegui concluir essa acao.';
}

async function resetExpiredChatSession(ctx: ReplyableContext) {
  const now = Date.now();
  const session = chatSessions.get(ctx.from.id);

  if (!session) {
    chatSessions.set(ctx.from.id, { lastInteractionAt: now });
    return;
  }

  if (now - session.lastInteractionAt < CHAT_SESSION_RESET_MS) {
    session.lastInteractionAt = now;
    return;
  }

  pendingTransactions.delete(ctx.from.id);
  chatSessions.set(ctx.from.id, { lastInteractionAt: now });
  logInfo('chat_session_reset', { reason: 'daily_inactivity' });

  await ctx.reply(
    'Sessao reiniciada apos um dia sem atividade. Use o menu abaixo para continuar.',
    mainMenuKeyboard(),
  );
}

function createPendingTransaction(
  userId: number,
  input: Omit<PendingTransaction, 'createdAt' | 'id'>,
) {
  const pending = {
    ...input,
    id: Math.random().toString(36).slice(2, 8),
    createdAt: Date.now(),
  };

  pendingTransactions.set(userId, pending);
  return pending;
}

function getPendingTransaction(userId: number, id: string) {
  const pending = pendingTransactions.get(userId);

  if (!pending || pending.id !== id) {
    return undefined;
  }

  if (Date.now() - pending.createdAt > PENDING_TRANSACTION_TTL_MS) {
    pendingTransactions.delete(userId);
    return undefined;
  }

  return pending;
}

function getCategoriesForType(categories: Category[], type: TransactionType) {
  return categories
    .filter((category) => category.type === 'both' || category.type === type)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function formatMoney(value: number | string) {
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatDateTime(value: string | undefined) {
  const date = value ? new Date(value) : new Date();

  return date.toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatTransactionConfirmation(
  transaction: Transaction,
  categoryName: string | undefined,
) {
  const typeLabel = transaction.type === 'expense' ? 'Gasto' : 'Receita';

  return [
    'Transacao lancada.',
    `Tipo: ${typeLabel}`,
    `Valor: ${formatMoney(transaction.amount)}`,
    `Descricao: ${transaction.description}`,
    `Categoria: ${categoryName ?? 'sem categoria'}`,
    `Data: ${formatDateTime(transaction.occurredAt)}`,
  ].join('\n');
}

function formatCategoryList(categories: Category[]) {
  if (categories.length === 0) {
    return 'Nenhuma categoria cadastrada.';
  }

  const expense = categories.filter((category) => category.type === 'expense');
  const income = categories.filter((category) => category.type === 'income');
  const both = categories.filter((category) => category.type === 'both');

  return [
    'Categorias cadastradas:',
    '',
    `Gastos: ${formatCategoryNames(expense)}`,
    `Receitas: ${formatCategoryNames(income)}`,
    `Ambas: ${formatCategoryNames(both)}`,
  ].join('\n');
}

function formatCategoryNames(categories: Category[]) {
  if (categories.length === 0) {
    return 'nenhuma';
  }

  return [...categories]
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((category) => category.name)
    .join(', ');
}

function typeKeyboard(pendingId: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Gasto', `tx:type:${pendingId}:expense`),
      Markup.button.callback('Receita', `tx:type:${pendingId}:income`),
    ],
    [Markup.button.callback('Cancelar', `tx:cancel:${pendingId}`)],
  ]);
}

function categoryKeyboard(pending: PendingTransaction) {
  if (!pending.type) {
    throw new Error('Tipo da transacao ainda nao foi definido.');
  }

  const buttons = getCategoriesForType(pending.categories, pending.type).map(
    (category) =>
      Markup.button.callback(
        category.name,
        `tx:cat:${pending.id}:${category.id}`,
      ),
  );
  const rows = chunk(buttons, 2);

  rows.push([Markup.button.callback('Sem categoria', `tx:nocat:${pending.id}`)]);
  rows.push([Markup.button.callback('Cancelar', `tx:cancel:${pending.id}`)]);

  return Markup.inlineKeyboard(rows);
}

function categoryPrompt(pending: PendingTransaction) {
  const typeLabel = pending.type === 'expense' ? 'gasto' : 'receita';

  return [
    `Categoria para este ${typeLabel}:`,
    `${formatMoney(pending.amount)} - ${pending.description}`,
  ].join('\n');
}

function chunk<T>(items: T[], size: number) {
  const rows: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }

  return rows;
}

async function createTransactionFromPending(
  pending: PendingTransaction,
  category: Category | undefined,
) {
  if (!pending.type) {
    throw new Error('Tipo da transacao ainda nao foi definido.');
  }

  const transaction = await api.createTransaction({
    type: pending.type,
    amount: pending.amount,
    description: pending.description,
    categoryId: category?.id,
  });

  logInfo('transaction_created', {
    type: pending.type,
    hasCategory: Boolean(category),
    guided: true,
  });

  return formatTransactionConfirmation(transaction, category?.name);
}

async function replyWithCategorySelection(
  ctx: ReplyableContext,
  pending: PendingTransaction,
) {
  if (!pending.type) {
    throw new Error('Tipo da transacao ainda nao foi definido.');
  }

  if (getCategoriesForType(pending.categories, pending.type).length === 0) {
    const confirmation = await createTransactionFromPending(pending, undefined);
    pendingTransactions.delete(ctx.from.id);
    await ctx.reply(confirmation, mainMenuKeyboard());
    return;
  }

  await ctx.reply(categoryPrompt(pending), categoryKeyboard(pending));
}

async function editToExpiredMessage(ctx: EditableContext) {
  await ctx.editMessageText('Esta operacao expirou. Envie a transacao novamente.')
    .catch(() => ctx.reply('Esta operacao expirou. Envie a transacao novamente.'));
}

async function sendHelp(ctx: ReplyableContext) {
  await ctx.reply(helpText(), mainMenuKeyboard());
}

async function sendMainMenu(ctx: ReplyableContext) {
  await ctx.reply('Menu principal:', mainMenuKeyboard());
}

async function sendTransactionPrompt(ctx: ReplyableContext) {
  await ctx.reply(transactionPromptText(), mainMenuKeyboard());
}

async function sendCategories(ctx: ReplyableContext) {
  try {
    const categories = await api.getCategories({ forceRefresh: true });
    logInfo('categories_listed', { count: categories.length });
    await ctx.reply(formatCategoryList(categories), mainMenuKeyboard());
  } catch (error) {
    logError('categories_list_failed', error);
    await ctx.reply(
      `${getUserErrorMessage(error)}\n\nUse /help para ver exemplos.`,
      mainMenuKeyboard(),
    );
  }
}

async function cancelPendingOperation(ctx: ReplyableContext) {
  const userId = ctx.from.id;
  const hadPending = pendingTransactions.delete(userId);

  logInfo('pending_operation_cancelled', { hadPending });
  await ctx.reply(
    hadPending
      ? 'Operacao cancelada.'
      : 'Nao ha operacao em andamento para cancelar.',
    mainMenuKeyboard(),
  );
}

async function sendMonthlySummary(ctx: ReplyableContext) {
  try {
    const now = new Date();
    const summary = await api.getMonthlySummary(
      now.getFullYear(),
      now.getMonth() + 1,
    );

    logInfo('monthly_summary_sent', {
      year: summary.year,
      month: summary.month,
    });
    await ctx.reply(
      [
        `Resumo ${String(summary.month).padStart(2, '0')}/${summary.year}`,
        `Receitas: ${formatMoney(summary.fixedIncomeTotal + summary.transactionIncomeTotal)}`,
        `Despesas: ${formatMoney(summary.fixedExpenseTotal + summary.transactionExpenseTotal)}`,
        `Saldo disponivel: ${formatMoney(summary.availableBalance)}`,
        `Orcamento diario sugerido: ${formatMoney(summary.suggestedDailyBudget)}`,
      ].join('\n'),
      mainMenuKeyboard(),
    );
  } catch (error) {
    logError('monthly_summary_failed', error);
    await ctx.reply(
      `${getUserErrorMessage(error)}\n\nUse /help para ver exemplos.`,
      mainMenuKeyboard(),
    );
  }
}

async function configureBotCommands() {
  try {
    await bot.telegram.setMyCommands([
      { command: 'start', description: 'Abrir o bot e mostrar o menu' },
      { command: 'menu', description: 'Mostrar menu principal' },
      { command: 'resumo', description: 'Consultar resumo do mes atual' },
      { command: 'categorias', description: 'Listar categorias cadastradas' },
      { command: 'cancelar', description: 'Cancelar operacao guiada' },
      { command: 'help', description: 'Ver exemplos de uso' },
    ]);
    logInfo('bot_commands_configured');
  } catch (error) {
    logError('bot_commands_configure_failed', error);
  }
}

async function ensureApiIsReachable() {
  try {
    await api.login();
    logInfo('api_login_ok');
  } catch (error) {
    logError('api_login_failed', error);
  }
}

bot.use(async (ctx, next) => {
  if (isAuthorized(ctx.from?.id)) {
    await resetExpiredChatSession(ctx as BotContext);
    return next();
  }

  if (ctx.from) {
    logWarn('unauthorized_access_blocked', { hasUser: true });
    await ctx.reply('Acesso negado.');
  }
});

bot.start((ctx) => ctx.reply(startText(), mainMenuKeyboard()));
bot.help(sendHelp);
bot.command('menu', sendMainMenu);
bot.command('categorias', sendCategories);
bot.command('cancelar', cancelPendingOperation);
bot.command('resumo', sendMonthlySummary);
bot.hears(MENU_BUTTONS.addTransaction, sendTransactionPrompt);
bot.hears(MENU_BUTTONS.summary, sendMonthlySummary);
bot.hears(MENU_BUTTONS.categories, sendCategories);
bot.hears(MENU_BUTTONS.cancel, cancelPendingOperation);
bot.hears(MENU_BUTTONS.help, sendHelp);

bot.action(/^tx:type:([a-z0-9]+):(income|expense)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const [, pendingId, type] = ctx.match;
  const pending = getPendingTransaction(ctx.from.id, pendingId);

  if (!pending) {
    await editToExpiredMessage(ctx);
    return;
  }

  pending.type = type as TransactionType;

  if (getCategoriesForType(pending.categories, pending.type).length === 0) {
    const confirmation = await createTransactionFromPending(pending, undefined);
    pendingTransactions.delete(ctx.from.id);
    await ctx.editMessageText(confirmation);
    await sendMainMenu(ctx);
    return;
  }

  await ctx.editMessageText(categoryPrompt(pending), categoryKeyboard(pending));
});

bot.action(/^tx:cat:([a-z0-9]+):(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const [, pendingId, categoryId] = ctx.match;
  const pending = getPendingTransaction(ctx.from.id, pendingId);

  if (!pending) {
    await editToExpiredMessage(ctx);
    return;
  }

  const category = pending.categories.find((item) => item.id === categoryId);

  if (!category) {
    logWarn('category_callback_not_found');
    await ctx.reply(
      'Categoria nao encontrada. Use /categorias para atualizar a lista.',
      mainMenuKeyboard(),
    );
    return;
  }

  const confirmation = await createTransactionFromPending(pending, category);
  pendingTransactions.delete(ctx.from.id);
  await ctx.editMessageText(confirmation);
  await sendMainMenu(ctx);
});

bot.action(/^tx:nocat:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const [, pendingId] = ctx.match;
  const pending = getPendingTransaction(ctx.from.id, pendingId);

  if (!pending) {
    await editToExpiredMessage(ctx);
    return;
  }

  const confirmation = await createTransactionFromPending(pending, undefined);
  pendingTransactions.delete(ctx.from.id);
  await ctx.editMessageText(confirmation);
  await sendMainMenu(ctx);
});

bot.action(/^tx:cancel:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery('Operacao cancelada.');

  const [, pendingId] = ctx.match;
  const pending = getPendingTransaction(ctx.from.id, pendingId);

  if (pending) {
    pendingTransactions.delete(ctx.from.id);
  }

  logInfo('pending_operation_cancelled', { hadPending: Boolean(pending) });
  await ctx.editMessageText('Operacao cancelada.');
  await sendMainMenu(ctx);
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  pendingTransactions.delete(userId);

  try {
    const categories = await api.getCategories();

    try {
      const parsed = parseTransactionMessage(ctx.message.text, categories);

      if (parsed.categoryId) {
        const transaction = await api.createTransaction({
          type: parsed.type,
          amount: parsed.amount,
          description: parsed.description,
          categoryId: parsed.categoryId,
        });

        logInfo('transaction_created', {
          type: parsed.type,
          hasCategory: true,
          guided: false,
        });
        await ctx.reply(
          formatTransactionConfirmation(transaction, parsed.categoryName),
          mainMenuKeyboard(),
        );
        return;
      }

      const pending = createPendingTransaction(userId, {
        type: parsed.type,
        amount: parsed.amount,
        description: parsed.description,
        categories,
      });

      await replyWithCategorySelection(ctx, pending);
      return;
    } catch (parseError) {
      if (startsWithKnownTypeCommand(ctx.message.text)) {
        throw parseError;
      }

      const loose = parseLooseTransactionMessage(ctx.message.text);
      const pending = createPendingTransaction(userId, {
        amount: loose.amount,
        description: loose.description,
        categories,
      });

      await ctx.reply(
        [
          'Nao identifiquei se isso e gasto ou receita.',
          `${formatMoney(pending.amount)} - ${pending.description}`,
        ].join('\n'),
        typeKeyboard(pending.id),
      );

      if (!(parseError instanceof Error)) {
        return;
      }
    }
  } catch (error) {
    logError('transaction_message_failed', error);
    await ctx.reply(
      `${getUserErrorMessage(error)}\n\nUse /help para ver exemplos.`,
      mainMenuKeyboard(),
    );
  }
});

bot.catch((error) => {
  logError('bot_unhandled_error', error);
});

bot
  .launch(async () => {
    await configureBotCommands();
    await ensureApiIsReachable();
    logInfo('bot_started');
  })
  .catch((error: unknown) => {
    logError('bot_start_failed', error);
    process.exitCode = 1;
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
