import { Category, TransactionType } from './api';

export type ParsedTransaction = {
  type: TransactionType;
  amount: number;
  description: string;
  categoryId?: string;
  categoryName?: string;
};

const TYPE_BY_COMMAND: Record<string, TransactionType> = {
  gasto: 'expense',
  receita: 'income',
};

export function parseTransactionMessage(
  text: string,
  categories: Category[],
): ParsedTransaction {
  const parts = text.trim().split(/\s+/);
  const [command, rawAmount, ...descriptionParts] = parts;
  const type = command ? TYPE_BY_COMMAND[command.toLowerCase()] : undefined;

  if (!type) {
    throw new Error('Use "gasto" ou "receita" no inicio da mensagem.');
  }

  const amount = Number(rawAmount?.replace(',', '.'));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Informe um valor numerico valido.');
  }

  if (descriptionParts.length === 0) {
    throw new Error('Informe uma descricao para a transacao.');
  }

  const category = findCategory(descriptionParts.at(-1), type, categories);
  const description = category
    ? descriptionParts.slice(0, -1).join(' ')
    : descriptionParts.join(' ');

  if (!description) {
    throw new Error('Informe uma descricao alem da categoria.');
  }

  return {
    type,
    amount: Math.round(amount * 100) / 100,
    description,
    categoryId: category?.id,
    categoryName: category?.name,
  };
}

function findCategory(
  value: string | undefined,
  type: TransactionType,
  categories: Category[],
) {
  if (!value) {
    return undefined;
  }

  const normalizedValue = normalize(value);

  return categories.find((category) => {
    const acceptsType = category.type === 'both' || category.type === type;
    return acceptsType && normalize(category.name) === normalizedValue;
  });
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
