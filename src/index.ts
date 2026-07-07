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
const MENU_BUTTONS = {
  addExpense: '🔴 Lançar gasto',
  addIncome: '🟢 Lançar entrada',
  summary: '🔵 Resumo',
  categories: '🟣 Categorias',
  cancel: '⚪ Cancelar',
  help: '❔ Ajuda',
} as const;
const LEGACY_MENU_BUTTONS = {
  addExpense: ['🔴 Lancar gasto', 'Lancar gasto', 'Lançar gasto'],
  addIncome: ['🟢 Lancar entrada', 'Lancar entrada', 'Lançar entrada'],
  addTransaction: ['Lancar transacao', 'Lançar transação'],
};

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

type PendingTypeSelection = {
  type: TransactionType;
  createdAt: number;
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
const pendingTypeSelections = new Map<number, PendingTypeSelection>();
const chatSessions = new Map<number, ChatSession>();
const trackedChatMessages = new Map<number, Set<number>>();

function isAuthorized(userId: number | undefined) {
  return userId === config.telegramUserId;
}

function startsWithKnownTypeCommand(text: string) {
  const [command] = text.trim().split(/\s+/);
  return ['gasto', 'receita'].includes(command?.toLowerCase() ?? '');
}

function mainMenuKeyboard() {
  return Markup.keyboard([
    [
      menuButton(MENU_BUTTONS.addExpense, 'danger'),
      menuButton(MENU_BUTTONS.addIncome, 'success'),
    ],
    [MENU_BUTTONS.summary, MENU_BUTTONS.categories],
    [MENU_BUTTONS.cancel, MENU_BUTTONS.help],
  ])
    .resize()
    .persistent();
}

function menuButton(
  text: string,
  style: 'danger' | 'success' | 'primary',
) {
  return { text, style } as never;
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

function typedTransactionPromptText(type: TransactionType) {
  const typeLabel = type === 'expense' ? 'gasto' : 'entrada';
  const example =
    type === 'expense'
      ? '32.90 almoco alimentacao'
      : '1200 freela trabalho';

  return [
    `Envie os dados da ${typeLabel}.`,
    '',
    `Exemplo: ${example}`,
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

function trackMessage(chatId: number | undefined, messageId: number | undefined) {
  if (!chatId || !messageId) {
    return;
  }

  const messages = trackedChatMessages.get(chatId) ?? new Set<number>();
  messages.add(messageId);
  trackedChatMessages.set(chatId, messages);
}

function trackIncomingMessage(ctx: Context) {
  if (!ctx.chat || !('message' in ctx) || !ctx.message) {
    return;
  }

  trackMessage(ctx.chat.id, ctx.message.message_id);
}

async function trackedReply(
  ctx: ReplyableContext,
  text: string,
  extra?: Parameters<Context['reply']>[1],
) {
  const message = await ctx.reply(text, extra);
  trackMessage(message.chat.id, message.message_id);
  return message;
}

function resetUserState(userId: number) {
  pendingTransactions.delete(userId);
  pendingTypeSelections.delete(userId);
}

function getNextMidnightDelay() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setDate(now.getDate() + 1);
  nextMidnight.setHours(0, 0, 0, 0);

  return nextMidnight.getTime() - now.getTime();
}

function scheduleDailyChatReset() {
  setTimeout(async () => {
    await resetTrackedChatsAtMidnight();
    scheduleDailyChatReset();
  }, getNextMidnightDelay());
}

async function resetTrackedChatsAtMidnight() {
  const chatIds = new Set<number>([
    ...trackedChatMessages.keys(),
    config.telegramUserId,
  ]);

  resetUserState(config.telegramUserId);
  chatSessions.delete(config.telegramUserId);

  for (const chatId of chatIds) {
    const messageIds = trackedChatMessages.get(chatId) ?? new Set<number>();

    for (const messageId of messageIds) {
      try {
        await bot.telegram.deleteMessage(chatId, messageId);
      } catch (error) {
        logWarn('daily_message_delete_failed', { chatId, messageId });
      }
    }

    trackedChatMessages.set(chatId, new Set<number>());

    try {
      const message = await bot.telegram.sendMessage(
        chatId,
        'Novo dia iniciado. Limpei a sessao do bot e reabri o menu.',
        mainMenuKeyboard(),
      );
      trackMessage(message.chat.id, message.message_id);
    } catch (error) {
      logError('daily_reset_menu_send_failed', error, { chatId });
    }
  }

  logInfo('daily_chat_reset_completed', { chatCount: chatIds.size });
}

async function resetExpiredChatSession(ctx: ReplyableContext) {
  chatSessions.set(ctx.from.id, { lastInteractionAt: Date.now() });
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

function setPendingTypeSelection(userId: number, type: TransactionType) {
  pendingTransactions.delete(userId);
  pendingTypeSelections.set(userId, {
    type,
    createdAt: Date.now(),
  });
}

function consumePendingTypeSelection(userId: number) {
  const pendingType = pendingTypeSelections.get(userId);

  if (!pendingType) {
    return undefined;
  }

  pendingTypeSelections.delete(userId);

  if (Date.now() - pendingType.createdAt > PENDING_TRANSACTION_TTL_MS) {
    return undefined;
  }

  return pendingType.type;
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
    await trackedReply(ctx, confirmation, mainMenuKeyboard());
    return;
  }

  await trackedReply(ctx, categoryPrompt(pending), categoryKeyboard(pending));
}

async function editToExpiredMessage(ctx: EditableContext) {
  await ctx.editMessageText('Esta operacao expirou. Envie a transacao novamente.')
    .catch(() =>
      trackedReply(ctx, 'Esta operacao expirou. Envie a transacao novamente.'),
    );
}

async function sendHelp(ctx: ReplyableContext) {
  await trackedReply(ctx, helpText(), mainMenuKeyboard());
}

async function sendMainMenu(ctx: ReplyableContext) {
  await trackedReply(ctx, 'Menu principal:', mainMenuKeyboard());
}

async function sendTransactionPrompt(ctx: ReplyableContext) {
  await trackedReply(ctx, transactionPromptText(), mainMenuKeyboard());
}

async function startTypedTransaction(ctx: ReplyableContext, type: TransactionType) {
  setPendingTypeSelection(ctx.from.id, type);
  await trackedReply(ctx, typedTransactionPromptText(type), mainMenuKeyboard());
}

async function sendCategories(ctx: ReplyableContext) {
  try {
    const categories = await api.getCategories({ forceRefresh: true });
    logInfo('categories_listed', { count: categories.length });
    await trackedReply(ctx, formatCategoryList(categories), mainMenuKeyboard());
  } catch (error) {
    logError('categories_list_failed', error);
    await trackedReply(
      ctx,
      `${getUserErrorMessage(error)}\n\nUse /help para ver exemplos.`,
      mainMenuKeyboard(),
    );
  }
}

async function cancelPendingOperation(ctx: ReplyableContext) {
  const userId = ctx.from.id;
  const hadPending =
    pendingTransactions.delete(userId) || pendingTypeSelections.delete(userId);

  logInfo('pending_operation_cancelled', { hadPending });
  await trackedReply(
    ctx,
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
    await trackedReply(
      ctx,
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
    await trackedReply(
      ctx,
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
    trackIncomingMessage(ctx);
    await resetExpiredChatSession(ctx as BotContext);
    return next();
  }

  if (ctx.from) {
    logWarn('unauthorized_access_blocked', { hasUser: true });
    await ctx.reply('Acesso negado.');
  }
});

bot.start((ctx) => trackedReply(ctx, startText(), mainMenuKeyboard()));
bot.help(sendHelp);
bot.command('menu', sendMainMenu);
bot.command('categorias', sendCategories);
bot.command('cancelar', cancelPendingOperation);
bot.command('resumo', sendMonthlySummary);
bot.hears([MENU_BUTTONS.addExpense, ...LEGACY_MENU_BUTTONS.addExpense], (ctx) =>
  startTypedTransaction(ctx, 'expense'),
);
bot.hears([MENU_BUTTONS.addIncome, ...LEGACY_MENU_BUTTONS.addIncome], (ctx) =>
  startTypedTransaction(ctx, 'income'),
);
bot.hears(LEGACY_MENU_BUTTONS.addTransaction, sendTransactionPrompt);
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
    await trackedReply(
      ctx,
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
    const pendingType = consumePendingTypeSelection(userId);

    if (pendingType) {
      const loose = parseLooseTransactionMessage(ctx.message.text);
      const pending = createPendingTransaction(userId, {
        type: pendingType,
        amount: loose.amount,
        description: loose.description,
        categories,
      });

      await replyWithCategorySelection(ctx, pending);
      return;
    }

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
        await trackedReply(
          ctx,
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

      await trackedReply(
        ctx,
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
    await trackedReply(
      ctx,
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
    scheduleDailyChatReset();
    logInfo('bot_started');
  })
  .catch((error: unknown) => {
    logError('bot_start_failed', error);
    process.exitCode = 1;
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
