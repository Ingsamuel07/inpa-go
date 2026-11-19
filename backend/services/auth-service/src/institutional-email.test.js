import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUniqueInstitutionalEmail, institutionalEmailBase } from './institutional-email.js';

test('builds a normalized institutional address from first name and surname', () => {
  assert.equal(institutionalEmailBase('María Paula Gómez Ríos'), 'maria.rios@uninpahu.edu.co');
  assert.equal(institutionalEmailBase('Prof. Andrés Felipe Mora'), 'andres.mora@uninpahu.edu.co');
});

test('adds a numeric suffix when the base address is already taken', async () => {
  const taken = new Set(['carlos.silva@uninpahu.edu.co', 'carlos.silva2@uninpahu.edu.co']);
  const email = await generateUniqueInstitutionalEmail('Carlos Alberto Silva', (candidate) => taken.has(candidate));
  assert.equal(email, 'carlos.silva3@uninpahu.edu.co');
});

test('rejects names that cannot produce an address', () => {
  assert.throws(() => institutionalEmailBase('---'), { code: 'INVALID_NAME' });
});
