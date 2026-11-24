const test = require('node:test');
const assert = require('node:assert/strict');
const { parseExpense, getReportRange } = require('../src/services/whatsapp-text');

test('interpreta descrição e valor com centavos em diferentes formatos', () => {
  for (const [message, description, value] of [
    ['cabelo 35 reais', 'cabelo', 35],
    ['35 cabelo', 'cabelo', 35],
    ['café R$ 12,5', 'café', 12.5],
    ['R$1.234,56 mercado', 'mercado', 1234.56],
    ['  ônibus  4.80 ', 'ônibus', 4.8],
    ['2 ingressos R$ 80', '2 ingressos', 80],
  ]) {
    assert.deepEqual(parseExpense(message), { description, value });
  }
});

test('rejeita valores ambíguos, fora do intervalo e sem descrição', () => {
  for (const message of [
    'café 0', 'café -12', 'café 1,234', 'café 1.234', '35', '2 ingressos 80',
    'café 10000000000', 'café R$ 5 20', '35 40', 'oi',
  ]) {
    assert.equal(parseExpense(message), null, message);
  }
});

test('relatórios usam calendário brasileiro mesmo perto da virada UTC', () => {
  const date = new Date('2026-11-02T01:30:00Z');
  assert.deepEqual(getReportRange('diario', date), { title: 'Hoje', start: '2026-11-01', end: '2026-11-01' });
  assert.deepEqual(getReportRange('semanal', date), { title: 'Esta semana', start: '2026-10-26', end: '2026-11-01' });
  assert.deepEqual(getReportRange('mensal', date), { title: 'Este mês', start: '2026-11-01', end: '2026-11-01' });
  assert.deepEqual(getReportRange('total', date), { title: 'Todo o período', start: null, end: '2026-11-01' });
});
