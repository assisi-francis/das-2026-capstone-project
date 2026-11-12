import { randomBytes, randomUUID } from 'node:crypto';
import { DomainError } from './errors.js';

// No 0/O or 1/I, so a code read out loud at the door is hard to get wrong.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 characters

export function newId() {
  return randomUUID();
}

function createReference(length) {
  if (!Number.isSafeInteger(length) || length < 1 || length > 128) {
    throw new DomainError('VALIDATION', 'Reference length must be a whole number between 1 and 128');
  }

  // 32 characters divides 256 evenly, so `byte % 32` has no bias.
  const bytes = randomBytes(length);
  let code = '';
  for (const byte of bytes) {
    code += ALPHABET[byte % ALPHABET.length];
  }
  return code;
}

export function newReference() {
  return createReference(8);
}

// Keep the existing name for the API and scripts from later builds.
export function referenceCode(length = 8) {
  return createReference(length);
}
