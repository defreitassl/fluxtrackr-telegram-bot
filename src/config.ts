import { config as loadDotenv } from 'dotenv';

loadDotenv({
  path: new URL('../.env', import.meta.url),
  quiet: true,
});

type BotConfig = {
  telegramBotToken: string;
  telegramUserId: number;
  apiBaseUrl: string;
  botUserEmail: string;
  botUserPassword: string;
};

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredNumberEnv(name: string) {
  const value = Number(requiredEnv(name));

  if (!Number.isInteger(value)) {
    throw new Error(`Environment variable ${name} must be an integer`);
  }

  return value;
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

export function loadConfig(): BotConfig {
  return {
    telegramBotToken: requiredEnv('TELEGRAM_BOT_TOKEN'),
    telegramUserId: requiredNumberEnv('TELEGRAM_USER_ID'),
    apiBaseUrl: normalizeApiBaseUrl(
      process.env.API_BASE_URL ?? 'http://localhost:3001',
    ),
    botUserEmail: requiredEnv('BOT_USER_EMAIL'),
    botUserPassword: requiredEnv('BOT_USER_PASSWORD'),
  };
}
