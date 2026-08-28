const test = require('node:test');
const assert = require('node:assert/strict');

const { ApiError } = require('../src/middleware/errorHandler');
const {
  validateDateOnly,
  validateEmail,
  validateInteger,
  validateNonNegativeMoney,
  validatePositiveMoney,
  validateUuid,
} = require('../src/utils/validation');

test('normaliza e valida e-mail sem alterar a senha', () => {
  assert.equal(validateEmail('  Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
  assert.throws(() => validateEmail('invalido'), ApiError);
});

test('rejeita datas impossiveis e preserva YYYY-MM-DD', () => {
  assert.equal(validateDateOnly('2026-02-28'), '2026-02-28');
  assert.throws(() => validateDateOnly('2026-02-30'), /data valida/);
  assert.throws(() => validateDateOnly('28/02/2026'), /YYYY-MM-DD/);
});

test('valida dinheiro e inteiros nos limites do schema', () => {
  assert.equal(validatePositiveMoney('10.129'), 10.13);
  assert.equal(validateNonNegativeMoney(0), 0);
  assert.equal(validateInteger('12', 'mes', { min: 1, max: 12 }), 12);
  assert.throws(() => validatePositiveMoney(0), /maior que zero/);
  assert.throws(() => validateInteger(13, 'mes', { min: 1, max: 12 }), /no maximo/);
});

test('rejeita UUID malformado antes de consultar o banco', () => {
  assert.equal(validateUuid('b6fdfd35-3c12-4ff9-a61e-470f821b634b', 'id'), 'b6fdfd35-3c12-4ff9-a61e-470f821b634b');
  assert.throws(() => validateUuid('nao-e-uuid', 'id'), /UUID valido/);
});
