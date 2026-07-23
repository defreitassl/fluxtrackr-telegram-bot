import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getWebhookUrl,
  loadConfig,
  normalizeApiBaseUrl,
  normalizeTelegramWebhookPath,
  normalizeWebhookBaseUrl,
} from '../src/config.js';

const validEnvironment: NodeJS.ProcessEnv = {
  TELEGRAM_BOT_TOKEN: 'telegram-token',
  TELEGRAM_USER_ID: '123456',
  API_BASE_URL: 'https://api.example.com',
  BOT_USER_EMAIL: 'bot@example.com',
  BOT_USER_PASSWORD: 'password',
  PORT: '3000',
  WEBHOOK_BASE_URL: 'https://bot.example.com/',
  TELEGRAM_WEBHOOK_PATH: '/telegram/webhook',
  TELEGRAM_WEBHOOK_SECRET: 'long-random-webhook-secret',
};

describe('normalizeApiBaseUrl', () => {
  it('allows local HTTP development URLs', () => {
    assert.equal(
      normalizeApiBaseUrl('http://localhost:3001/'),
      'http://localhost:3001',
    );
    assert.equal(
      normalizeApiBaseUrl('http://127.0.0.1:3001'),
      'http://127.0.0.1:3001',
    );
  });

  it('allows HTTPS URLs', () => {
    assert.equal(
      normalizeApiBaseUrl('https://api.example.com/'),
      'https://api.example.com',
    );
  });

  it('rejects non-local plaintext HTTP URLs', () => {
    assert.throws(
      () => normalizeApiBaseUrl('http://api.example.com'),
      /https outside local development/,
    );
  });
});

describe('webhook configuration', () => {
  it('normalizes a valid HTTPS base URL and builds the full webhook URL', () => {
    const config = loadConfig(validEnvironment);

    assert.equal(config.webhookBaseUrl, 'https://bot.example.com');
    assert.equal(getWebhookUrl(config), 'https://bot.example.com/telegram/webhook');
    assert.equal(normalizeWebhookBaseUrl('https://bot.example.com/'), 'https://bot.example.com');
  });

  it('rejects plaintext HTTP webhook URLs', () => {
    assert.throws(
      () => normalizeWebhookBaseUrl('http://bot.example.com'),
      /must use https/,
    );
  });

  it('rejects webhook paths without a leading slash', () => {
    assert.throws(
      () => normalizeTelegramWebhookPath('telegram/webhook'),
      /must start with/,
    );
  });

  it('requires a webhook secret', () => {
    const environment = { ...validEnvironment };
    delete environment.TELEGRAM_WEBHOOK_SECRET;

    assert.throws(
      () => loadConfig(environment),
      /Missing required environment variable: TELEGRAM_WEBHOOK_SECRET/,
    );
  });

  it('accepts a valid PORT and rejects an invalid one', () => {
    assert.equal(loadConfig(validEnvironment).port, 3000);
    assert.throws(
      () => loadConfig({ ...validEnvironment, PORT: 'invalid' }),
      /PORT must be an integer between 1 and 65535/,
    );
  });
});
