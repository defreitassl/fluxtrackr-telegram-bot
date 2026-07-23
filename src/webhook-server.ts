import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Telegraf } from 'telegraf';
import { type BotConfig } from './config.js';
import { logError } from './logger.js';

const HEALTH_PATH = '/health';
const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

export type WebhookServer = {
  close(): Promise<void>;
};

export async function startWebhookServer(
  bot: Telegraf,
  config: BotConfig,
): Promise<WebhookServer> {
  const webhookCallback = bot.webhookCallback(config.webhookPath, {
    secretToken: config.telegramWebhookSecret,
  });
  const server = createServer((request, response) => {
    const pathname = getPathname(request);

    if (request.method === 'GET' && pathname === HEALTH_PATH) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (request.method === 'POST' && pathname === config.webhookPath) {
      if (!hasValidTelegramSecret(request, config.telegramWebhookSecret)) {
        response.writeHead(403);
        response.end();
        return;
      }

      void webhookCallback(request, response).catch((error: unknown) => {
        logError('telegram_webhook_callback_failed', error);

        if (!response.headersSent) {
          response.writeHead(500);
          response.end();
        }
      });
      return;
    }

    response.writeHead(404);
    response.end();
  });

  await listen(server, config.port);

  return {
    close: () => close(server),
  };
}

function getPathname(request: IncomingMessage) {
  return new URL(request.url ?? '/', 'http://localhost').pathname;
}

function hasValidTelegramSecret(
  request: IncomingMessage,
  expectedSecret: string,
) {
  const receivedSecret = request.headers[TELEGRAM_SECRET_HEADER];

  if (typeof receivedSecret !== 'string') {
    return false;
  }

  const expected = Buffer.from(expectedSecret);
  const received = Buffer.from(receivedSecret);

  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
