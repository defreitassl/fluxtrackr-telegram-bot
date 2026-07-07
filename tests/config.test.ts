import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeApiBaseUrl } from '../src/config';

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
