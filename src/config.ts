import { config as loadDotenv } from 'dotenv';

loadDotenv({
  path: new URL('../.env', import.meta.url),
  quiet: true,
});

export type BotConfig = {
  telegramBotToken: string;
  telegramUserId: number;
  apiBaseUrl: string;
  botUserEmail: string;
  botUserPassword: string;
  port: number;
  webhookBaseUrl: string;
  webhookPath: string;
  telegramWebhookSecret: string;
};

function requiredEnv(name: string, environment: NodeJS.ProcessEnv) {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredNumberEnv(name: string, environment: NodeJS.ProcessEnv) {
  const value = Number(requiredEnv(name, environment));

  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }

  return value;
}

export function normalizePort(value: string) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return port;
}

export function normalizeApiBaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('API_BASE_URL must be a valid URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('API_BASE_URL must use http or https');
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

  if (url.protocol === 'http:' && !isLocalHttp) {
    throw new Error('API_BASE_URL must use https outside local development');
  }

  return url.toString().replace(/\/$/, '');
}

export function normalizeWebhookBaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('WEBHOOK_BASE_URL must be a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('WEBHOOK_BASE_URL must use https');
  }

  return url.toString().replace(/\/$/, '');
}

export function normalizeTelegramWebhookPath(value: string) {
  if (!value.startsWith('/')) {
    throw new Error('TELEGRAM_WEBHOOK_PATH must start with /');
  }

  return value;
}

export function getWebhookUrl(
  config: Pick<BotConfig, 'webhookBaseUrl' | 'webhookPath'>,
) {
  return `${config.webhookBaseUrl}${config.webhookPath}`;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BotConfig {
  return {
    telegramBotToken: requiredEnv('TELEGRAM_BOT_TOKEN', environment),
    telegramUserId: requiredNumberEnv('TELEGRAM_USER_ID', environment),
    apiBaseUrl: normalizeApiBaseUrl(
      environment.API_BASE_URL ?? 'http://localhost:3001',
    ),
    botUserEmail: requiredEnv('BOT_USER_EMAIL', environment),
    botUserPassword: requiredEnv('BOT_USER_PASSWORD', environment),
    port: normalizePort(environment.PORT ?? '3000'),
    webhookBaseUrl: normalizeWebhookBaseUrl(
      requiredEnv('WEBHOOK_BASE_URL', environment),
    ),
    webhookPath: normalizeTelegramWebhookPath(
      requiredEnv('TELEGRAM_WEBHOOK_PATH', environment),
    ),
    telegramWebhookSecret: requiredEnv(
      'TELEGRAM_WEBHOOK_SECRET',
      environment,
    ),
  };
}
