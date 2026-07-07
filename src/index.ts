import { Telegraf } from 'telegraf';
import { message } from 'telegraf/filters';
import { ApiClient } from './api';
import { loadConfig } from './config';
import { parseTransactionMessage } from './parser';

const config = loadConfig();
const api = new ApiClient({
  apiBaseUrl: config.apiBaseUrl,
  email: config.botUserEmail,
  password: config.botUserPassword,
});
const bot = new Telegraf(config.telegramBotToken);

function isAuthorized(userId: number | undefined) {
  return userId === config.telegramUserId;
}

function formatMoney(value: number | string) {
  return Number(value).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
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
    'FluxTrackr pronto. Envie uma transacao como: gasto 32.90 almoço alimentação',
  ),
);

bot.help((ctx) =>
  ctx.reply(
    [
      'Exemplos:',
      'gasto 32.90 almoço alimentação',
      'receita 1200 freela trabalho',
      '',
      'Comandos:',
      '/resumo - resumo do mes atual',
    ].join('\n'),
  ),
);

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

bot.on(message('text'), async (ctx) => {
  try {
    const categories = await api.getCategories();
    const parsed = parseTransactionMessage(ctx.message.text, categories);
    const transaction = await api.createTransaction({
      type: parsed.type,
      amount: parsed.amount,
      description: parsed.description,
      categoryId: parsed.categoryId,
    });
    const categoryText = parsed.categoryName
      ? ` em ${parsed.categoryName}`
      : ' sem categoria';

    await ctx.reply(
      `Lancado: ${transaction.type === 'expense' ? 'gasto' : 'receita'} de ${formatMoney(transaction.amount)} - ${transaction.description}${categoryText}.`,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Nao consegui registrar essa transacao.';
    await ctx.reply(`${message}\n\nUse /help para ver exemplos.`);
  }
});

bot
  .launch()
  .then(() => {
    console.log('Telegram bot started');
  })
  .catch((error: unknown) => {
    console.error('Failed to start Telegram bot', error);
    process.exitCode = 1;
  });

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
