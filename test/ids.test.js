import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newId, newReference, referenceCode } from '../src/domain/ids.js';
import { DomainError } from '../src/domain/errors.js';

describe('ids', () => {
  it('creates UUIDs and short readable references', () => {
    assert.match(newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(newReference(), /^[A-HJ-NP-Z2-9]{8}$/);
    assert.match(referenceCode(), /^[A-HJ-NP-Z2-9]{8}$/);
  });

  it('validates the legacy reference length argument', () => {
    assert.throws(() => referenceCode(0), (error) => error instanceof DomainError && error.code === 'VALIDATION');
    assert.throws(
      () => referenceCode(Number.MAX_SAFE_INTEGER + 1),
      (error) => error instanceof DomainError && error.code === 'VALIDATION',
    );
  });
});
