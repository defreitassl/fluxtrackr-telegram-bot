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

export function loadConfig(): BotConfig {
  return {
    telegramBotToken: requiredEnv('TELEGRAM_BOT_TOKEN'),
    telegramUserId: requiredNumberEnv('TELEGRAM_USER_ID'),
    apiBaseUrl: process.env.API_BASE_URL ?? 'http://localhost:3001',
    botUserEmail: process.env.BOT_USER_EMAIL ?? 'dev@fluxtrackr.local',
    botUserPassword: process.env.BOT_USER_PASSWORD ?? '123456',
  };
}
