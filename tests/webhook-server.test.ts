import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { Telegraf } from 'telegraf';
import { type BotConfig } from '../src/config.js';
import {
  startWebhookServer,
  type WebhookServer,
} from '../src/webhook-server.js';

const webhookSecret = 'long-random-webhook-secret';
let port = 0;
let webhookServer: WebhookServer;
let callbackCalls = 0;
let callbackPath: string | undefined;
let callbackSecret: string | undefined;

const config: BotConfig = {
  telegramBotToken: 'telegram-token',
  telegramUserId: 123456,
  apiBaseUrl: 'https://api.example.com',
  botUserEmail: 'bot@example.com',
  botUserPassword: 'password',
  port,
  webhookBaseUrl: 'https://bot.example.com',
  webhookPath: '/telegram/webhook',
  telegramWebhookSecret: webhookSecret,
};

const bot = {
  webhookCallback(path: string, options?: { secretToken?: string }) {
    callbackPath = path;
    callbackSecret = options?.secretToken;

    return async (_request: unknown, response: { writeHead: (statusCode: number) => void; end: (body?: string) => void }) => {
      callbackCalls += 1;
      response.writeHead(200);
      response.end('handled');
    };
  },
} as unknown as Telegraf;

describe('webhook server', () => {
  before(async () => {
    port = await getAvailablePort();
    config.port = port;
    webhookServer = await startWebhookServer(bot, config);
  });

  after(async () => {
    await webhookServer.close();
  });

  it('returns 200 from GET /health', async () => {
    const response = await request(port, '/health');

    assert.equal(response.statusCode, 200);
  });

  it('returns 404 for an unknown route', async () => {
    const response = await request(port, '/unknown');

    assert.equal(response.statusCode, 404);
  });

  it('returns 403 when the webhook secret is absent', async () => {
    const response = await request(port, config.webhookPath, {
      method: 'POST',
    });

    assert.equal(response.statusCode, 403);
    assert.equal(callbackCalls, 0);
  });

  it('returns 403 when the webhook secret is incorrect', async () => {
    const response = await request(port, config.webhookPath, {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': 'incorrect-secret',
      },
    });

    assert.equal(response.statusCode, 403);
    assert.equal(callbackCalls, 0);
  });

  it('forwards a webhook with the correct secret to Telegraf', async () => {
    const response = await request(port, config.webhookPath, {
      method: 'POST',
      headers: {
        'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
      },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(callbackCalls, 1);
    assert.equal(callbackPath, config.webhookPath);
    assert.equal(callbackSecret, webhookSecret);
  });
});

function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not reserve a test port')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

function request(
  requestPort: number,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {},
) {
  return new Promise<{ statusCode: number | undefined }>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: requestPort,
        path,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve({ statusCode: response.statusCode }));
      },
    );

    request.once('error', reject);
    request.end();
  });
}
