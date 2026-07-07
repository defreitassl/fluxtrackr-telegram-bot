export type TransactionType = 'income' | 'expense';
export type CategoryType = 'income' | 'expense' | 'both';

export type Category = {
  id: string;
  name: string;
  type: CategoryType;
};

export type Transaction = {
  id: string;
  type: TransactionType;
  amount: number | string;
  description: string;
  categoryId: string | null;
  occurredAt?: string;
  source: 'app' | 'telegram';
};

export type MonthlySummary = {
  year: number;
  month: number;
  fixedIncomeTotal: number;
  fixedExpenseTotal: number;
  transactionIncomeTotal: number;
  transactionExpenseTotal: number;
  availableBalance: number;
  suggestedDailyBudget: number;
};

type ApiClientConfig = {
  apiBaseUrl: string;
  email: string;
  password: string;
};

const CATEGORIES_CACHE_TTL_MS = 60_000;

type RequestOptions = {
  method?: string;
  token?: string;
  body?: unknown;
};

export class ApiClient {
  private token?: string;
  private categoriesCache?: {
    data: Category[];
    expiresAt: number;
  };

  constructor(private readonly config: ApiClientConfig) {}

  async login() {
    const data = await this.request<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: {
        email: this.config.email,
        password: this.config.password,
      },
    });

    this.token = data.accessToken;
    return data.accessToken;
  }

  async getCategories(options: { forceRefresh?: boolean } = {}) {
    const now = Date.now();

    if (
      !options.forceRefresh &&
      this.categoriesCache &&
      this.categoriesCache.expiresAt > now
    ) {
      return this.categoriesCache.data;
    }

    const data = await this.authenticatedRequest<Category[]>('/categories');
    this.categoriesCache = {
      data,
      expiresAt: now + CATEGORIES_CACHE_TTL_MS,
    };

    return data;
  }

  async createTransaction(input: {
    type: TransactionType;
    amount: number;
    description: string;
    categoryId?: string;
  }) {
    return this.authenticatedRequest<Transaction>('/transactions', {
      method: 'POST',
      body: {
        ...input,
        source: 'telegram',
      },
    });
  }

  async getMonthlySummary(year: number, month: number) {
    return this.authenticatedRequest<MonthlySummary>(
      `/monthly-summary?year=${year}&month=${month}`,
    );
  }

  private async authenticatedRequest<T>(
    path: string,
    options: RequestOptions = {},
  ) {
    const token = this.token ?? (await this.login());

    try {
      return await this.request<T>(path, { ...options, token });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const freshToken = await this.login();
        return this.request<T>(path, { ...options, token: freshToken });
      }

      throw error;
    }
  }

  private async request<T>(path: string, options: RequestOptions = {}) {
    let response: Response;

    try {
      response = await fetch(`${this.config.apiBaseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ApiConnectionError('Nao consegui conectar na API.');
    }

    const text = await response.text();
    const data = parseJsonResponse(text);

    if (!response.ok) {
      const message =
        data?.message ?? `Request failed with status ${response.status}`;
      throw new ApiError(
        response.status,
        Array.isArray(message) ? message.join(', ') : message,
      );
    }

    return data as T;
  }
}

function parseJsonResponse(text: string) {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiResponseError('A API retornou uma resposta invalida.');
  }
}

export class ApiError extends Error {
  readonly name = 'ApiError';

  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ApiConnectionError extends Error {
  readonly name = 'ApiConnectionError';
}

export class ApiResponseError extends Error {
  readonly name = 'ApiResponseError';
}
