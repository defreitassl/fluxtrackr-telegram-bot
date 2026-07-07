import https from 'node:https';
import { Context, Markup, Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { ApiClient, Category, Transaction, TransactionType } from './api';
import { loadConfig } from './config';
import {
  parseLooseTransactionMessage,
  parseTransactionMessage,
} from './parser';

const PENDING_TRANSACTION_TTL_MS = 10 * 60 * 1000;

type PendingTransaction = {
  id: string;
  amount: number;
  description: string;
  categories: Category[];
  createdAt: number;
  type?: TransactionType;
};

type ReplyableContext = Pick<Context, 'reply'> & {
  from: { id: number };
};

type EditableContext = ReplyableContext & Pick<Context, 'editMessageText'>;

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

function isAuthorized(userId: number | undefined) {
  return userId === config.telegramUserId;
}

function startsWithKnownTypeCommand(text: string) {
  const [command] = text.trim().split(/\s+/);
  return ['gasto', 'receita'].includes(command?.toLowerCase() ?? '');
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
    await ctx.reply(confirmation);
    return;
  }

  await ctx.reply(categoryPrompt(pending), categoryKeyboard(pending));
}

async function editToExpiredMessage(ctx: EditableContext) {
  await ctx.editMessageText('Esta operacao expirou. Envie a transacao novamente.')
    .catch(() => ctx.reply('Esta operacao expirou. Envie a transacao novamente.'));
}

bot.use(async (ctx, next) => {
  if (isAuthorized(ctx.from?.id)) {
    return next();
  }

  if (ctx.from) {
    await ctx.reply('Acesso negado.');
  }
});

bot.start((ctx) =>
  ctx.reply(
    [
      'FluxTrackr pronto.',
      'Envie uma transacao como: gasto 32.90 almoco alimentacao',
      'Use /help para ver comandos.',
    ].join('\n'),
  ),
);

bot.help((ctx) =>
  ctx.reply(
    [
      'Exemplos:',
      'gasto 32.90 almoco alimentacao',
      'receita 1200 freela trabalho',
      '32.90 almoco',
      '',
      'Comandos:',
      '/resumo - resumo do mes atual',
      '/categorias - listar categorias cadastradas',
      '/cancelar - cancelar uma operacao guiada',
    ].join('\n'),
  ),
);

bot.command('categorias', async (ctx) => {
  try {
    const categories = await api.getCategories({ forceRefresh: true });
    await ctx.reply(formatCategoryList(categories));
  } catch {
    await ctx.reply('Nao consegui consultar as categorias agora.');
  }
});

bot.command('cancelar', async (ctx) => {
  const userId = ctx.from.id;
  const hadPending = pendingTransactions.delete(userId);

  await ctx.reply(
    hadPending
      ? 'Operacao cancelada.'
      : 'Nao ha operacao em andamento para cancelar.',
  );
});

bot.command('resumo', async (ctx) => {
  try {
    const now = new Date();
    const summary = await api.getMonthlySummary(
      now.getFullYear(),
      now.getMonth() + 1,
    );

    await ctx.reply(
      [
        `Resumo ${String(summary.month).padStart(2, '0')}/${summary.year}`,
        `Receitas: ${formatMoney(summary.fixedIncomeTotal + summary.transactionIncomeTotal)}`,
        `Despesas: ${formatMoney(summary.fixedExpenseTotal + summary.transactionExpenseTotal)}`,
        `Saldo disponivel: ${formatMoney(summary.availableBalance)}`,
        `Orcamento diario sugerido: ${formatMoney(summary.suggestedDailyBudget)}`,
      ].join('\n'),
    );
  } catch {
    await ctx.reply('Nao consegui consultar o resumo agora.');
  }
});

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
    await ctx.reply('Categoria nao encontrada. Use /categorias para atualizar a lista.');
    return;
  }

  const confirmation = await createTransactionFromPending(pending, category);
  pendingTransactions.delete(ctx.from.id);
  await ctx.editMessageText(confirmation);
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
});

bot.action(/^tx:cancel:([a-z0-9]+)$/, async (ctx) => {
  await ctx.answerCbQuery('Operacao cancelada.');

  const [, pendingId] = ctx.match;
  const pending = getPendingTransaction(ctx.from.id, pendingId);

  if (pending) {
    pendingTransactions.delete(ctx.from.id);
  }

  await ctx.editMessageText('Operacao cancelada.');
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

        await ctx.reply(
          formatTransactionConfirmation(transaction, parsed.categoryName),
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
    const message =
      error instanceof Error
        ? error.message
        : 'Nao consegui registrar essa transacao.';
    await ctx.reply(`${message}\n\nUse /help para ver exemplos.`);
  }
});

bot
  .launch(() => {
    console.log('Telegram bot started');
  })
  .catch((error: unknown) => {
    console.error('Failed to start Telegram bot', error);
    process.exitCode = 1;
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
