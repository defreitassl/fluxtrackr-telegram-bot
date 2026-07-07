type LogLevel = 'info' | 'warn' | 'error';

type LogData = Record<string, string | number | boolean | null | undefined>;

export function logInfo(event: string, data: LogData = {}) {
  writeLog('info', event, data);
}

export function logWarn(event: string, data: LogData = {}) {
  writeLog('warn', event, data);
}

export function logError(event: string, error: unknown, data: LogData = {}) {
  const normalized = normalizeError(error);

  writeLog('error', event, {
    ...data,
    errorName: normalized.name,
    errorMessage: normalized.message,
    errorStatus: normalized.status,
  });
}

function writeLog(level: LogLevel, event: string, data: LogData) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...data,
    }),
  );
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    const status =
      'status' in error && typeof error.status === 'number'
        ? error.status
        : undefined;

    return {
      name: error.name,
      message: error.message,
      status,
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown error',
    status: undefined,
  };
}
