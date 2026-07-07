import { Category, TransactionType } from './api';

export type ParsedTransaction = {
  type: TransactionType;
  amount: number;
  description: string;
  categoryId?: string;
  categoryName?: string;
};

export type LooseParsedTransaction = {
  amount: number;
  description: string;
};

export class TransactionParseError extends Error {
  readonly name = 'TransactionParseError';
}

export const DEFAULT_TRANSACTION_DESCRIPTION = 'Sem descrição';

const TYPE_BY_COMMAND: Record<string, TransactionType> = {
  gasto: 'expense',
  receita: 'income',
};

export function parseTransactionMessage(
  text: string,
  categories: Category[],
): ParsedTransaction {
  const parts = text.trim().split(/\s+/);
  const [command] = parts;
  const type = command ? TYPE_BY_COMMAND[command.toLowerCase()] : undefined;

  if (!type) {
    throw new TransactionParseError(
      'Use "gasto" ou "receita" no inicio da mensagem.',
    );
  }

  const amountResult = parseAmountAt(parts, 1);

  if (!amountResult) {
    throw new TransactionParseError('Informe um valor numerico valido.');
  }

  const { amount } = amountResult;
  const descriptionParts = parts.slice(amountResult.endIndex);

  const resolvedCategory = findCategoryInDescription(
    descriptionParts,
    type,
    categories,
  );
  const description = resolvedCategory.descriptionParts.join(' ');

  return {
    type,
    amount: Math.round(amount * 100) / 100,
    description: description || DEFAULT_TRANSACTION_DESCRIPTION,
    categoryId: resolvedCategory.category?.id,
    categoryName: resolvedCategory.category?.name,
  };
}

export function parseLooseTransactionMessage(
  text: string,
): LooseParsedTransaction {
  const parts = text.trim().split(/\s+/);
  const amountResult = findAmount(parts);

  if (!amountResult) {
    throw new TransactionParseError('Informe um valor numerico valido.');
  }

  const description = parts
    .filter(
      (_, index) =>
        index < amountResult.startIndex || index >= amountResult.endIndex,
    )
    .join(' ')
    .trim();

  return {
    amount: Math.round(amountResult.amount * 100) / 100,
    description: description || DEFAULT_TRANSACTION_DESCRIPTION,
  };
}

function findAmount(parts: string[]) {
  for (let index = 0; index < parts.length; index += 1) {
    const amount = parseAmountAt(parts, index);

    if (amount) {
      return amount;
    }
  }

  return undefined;
}

function parseAmountAt(parts: string[], startIndex: number) {
  const current = parts[startIndex];

  if (!current) {
    return undefined;
  }

  const joinedWithNext =
    /^r\$$/i.test(current) && parts[startIndex + 1]
      ? `${current} ${parts[startIndex + 1]}`
      : current;
  const amount = parseMoney(joinedWithNext);

  if (!amount) {
    return undefined;
  }

  return {
    amount,
    startIndex,
    endIndex: joinedWithNext === current ? startIndex + 1 : startIndex + 2,
  };
}

function parseMoney(rawValue: string) {
  const value = rawValue
    .trim()
    .replace(/^r\$\s*/i, '')
    .replace(/\s+/g, '');

  if (!/^\d[\d.,]*$/.test(value)) {
    return undefined;
  }

  const normalized = value.includes(',')
    ? value.replaceAll('.', '').replace(',', '.')
    : normalizeDotOnlyMoney(value);

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return undefined;
  }

  const amount = Number(normalized);

  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function normalizeDotOnlyMoney(value: string) {
  if (/^\d{1,3}(\.\d{3})+$/.test(value)) {
    return value.replaceAll('.', '');
  }

  return value;
}

function findCategoryInDescription(
  descriptionParts: string[],
  type: TransactionType,
  categories: Category[],
) {
  const normalizedParts = descriptionParts.map(normalize);
  const candidates = categories
    .filter((category) => category.type === 'both' || category.type === type)
    .map((category) => ({
      category,
      parts: category.name.trim().split(/\s+/).map(normalize),
    }))
    .sort((a, b) => b.parts.length - a.parts.length);

  for (const candidate of candidates) {
    const index = findSequenceIndex(normalizedParts, candidate.parts);

    if (index === -1) {
      continue;
    }

    return {
      category: candidate.category,
      descriptionParts: [
        ...descriptionParts.slice(0, index),
        ...descriptionParts.slice(index + candidate.parts.length),
      ],
    };
  }

  return {
    category: undefined,
    descriptionParts,
  };
}

function findSequenceIndex(parts: string[], sequence: string[]) {
  if (sequence.length === 0 || sequence.length > parts.length) {
    return -1;
  }

  for (let index = 0; index <= parts.length - sequence.length; index += 1) {
    const matches = sequence.every(
      (sequencePart, offset) => parts[index + offset] === sequencePart,
    );

    if (matches) {
      return index;
    }
  }

  return -1;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
