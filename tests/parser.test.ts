import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TRANSACTION_DESCRIPTION,
  parseLooseTransactionMessage,
  parseTransactionMessage,
  TransactionParseError,
} from '../src/parser';

const categories = [
  { id: 'food', name: 'alimentação', type: 'expense' as const },
  { id: 'work', name: 'trabalho', type: 'income' as const },
];

describe('parseTransactionMessage', () => {
  it('parses decimal point amounts', () => {
    assert.deepEqual(parseTransactionMessage('gasto 32.90 almoço', categories), {
      type: 'expense',
      amount: 32.9,
      description: 'almoço',
      categoryId: undefined,
      categoryName: undefined,
    });
  });

  it('parses Brazilian currency formats', () => {
    assert.deepEqual(
      parseTransactionMessage('gasto R$ 1.234,56 mercado alimentação', categories),
      {
        type: 'expense',
        amount: 1234.56,
        description: 'mercado',
        categoryId: 'food',
        categoryName: 'alimentação',
      },
    );

    assert.equal(
      parseTransactionMessage('receita R$32,90 freela trabalho', categories).amount,
      32.9,
    );
  });

  it('uses a default description when only amount is provided', () => {
    assert.deepEqual(parseTransactionMessage('gasto 32.90', categories), {
      type: 'expense',
      amount: 32.9,
      description: DEFAULT_TRANSACTION_DESCRIPTION,
      categoryId: undefined,
      categoryName: undefined,
    });
  });

  it('allows category without a separate description', () => {
    assert.deepEqual(parseTransactionMessage('gasto 32.90 alimentação', categories), {
      type: 'expense',
      amount: 32.9,
      description: DEFAULT_TRANSACTION_DESCRIPTION,
      categoryId: 'food',
      categoryName: 'alimentação',
    });
  });

  it('throws a typed parse error for invalid amounts', () => {
    assert.throws(
      () => parseTransactionMessage('gasto R$ almoço', categories),
      TransactionParseError,
    );
  });
});

describe('parseLooseTransactionMessage', () => {
  it('removes split currency tokens from the description', () => {
    assert.deepEqual(parseLooseTransactionMessage('R$ 32,90 almoço'), {
      amount: 32.9,
      description: 'almoço',
    });
  });

  it('finds localized amounts anywhere in the message', () => {
    assert.deepEqual(parseLooseTransactionMessage('aluguel 1.234,56 julho'), {
      amount: 1234.56,
      description: 'aluguel julho',
    });
  });

  it('uses a default description for amount-only messages', () => {
    assert.deepEqual(parseLooseTransactionMessage('32.90'), {
      amount: 32.9,
      description: DEFAULT_TRANSACTION_DESCRIPTION,
    });
  });
});
