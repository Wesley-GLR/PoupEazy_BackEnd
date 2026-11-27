require('../test-support/safe-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { budgetAlertDecisions, currentBudgetPeriod, createBudgetEmailWorker } = require('../src/services/budget-email.service');
const { normalizeEmailPreferences } = require('../src/services/email-preferences.service');
const { budgetAlertEmail } = require('../src/emails/budget-alert');
const { financialEventsEmail } = require('../src/emails/financial-events');
const { createFinancialEventEmailWorker } = require('../src/services/financial-event-email.service');
const { createEmailAlertsWorker } = require('../src/services/email-alerts.worker');
const snapshot = { id_usuario: 'synthetic', email: 'budget@example.test', ano: 2026, mes: 11, valor_planejado: '100.00', gasto_confirmado: '80.00', percentual: 80 };

test('BUDGET-01 preferencias validam inteiro 1..100, boolean e campos somente leitura', () => {
  assert.deepEqual(normalizeEmailPreferences({ alerta_orcamento_ativo: false, alerta_orcamento_percentual: 80 }), { alerta_orcamento_ativo: false, alerta_orcamento_percentual: 80 });
  for (const percentual of [0, 101, 80.5, '80', null, true]) {
    assert.throws(() => normalizeEmailPreferences({ alerta_orcamento_percentual: percentual }), (error) => error.status === 422);
  }
  for (const body of [{}, [], null, { email_verificado: true }, { id_usuario: 'other' }, { alerta_orcamento_ativo: 'true' }]) {
    assert.throws(() => normalizeEmailPreferences(body));
  }
});

test('BUDGET-02 limiar inclui igualdade e excesso e estritamente maior que 100%', () => {
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, gasto_confirmado: '79.99' }), []);
  assert.deepEqual(budgetAlertDecisions(snapshot), [{ tipo: 'limiar', estado: 'reservado' }]);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, percentual: 100, gasto_confirmado: '100.00' }), [{ tipo: 'limiar', estado: 'reservado' }]);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, gasto_confirmado: '100.00' }, ['limiar']), []);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, gasto_confirmado: '100.01' }, ['limiar']), [{ tipo: 'excesso', estado: 'reservado' }]);
});

test('BUDGET-03 salto direto para excesso consolida e marcadores persistidos impedem repeticao', () => {
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, gasto_confirmado: '150.00' }), [
    { tipo: 'limiar', estado: 'coberto' }, { tipo: 'excesso', estado: 'reservado' },
  ]);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, gasto_confirmado: '900.00', percentual: 1 }, ['limiar', 'excesso']), []);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, valor_planejado: '0.00' }), []);
  assert.deepEqual(budgetAlertDecisions({ ...snapshot, valor_planejado: '9999999999999999.00', gasto_confirmado: '9999999999999998.99', percentual: 100 }), []);
});

test('BUDGET-04 competencia usa Sao Paulo na virada UTC e template expoe apenas resumo', () => {
  assert.deepEqual(currentBudgetPeriod(new Date('2026-12-01T01:00:00Z')), { ano: 2026, mes: 11 });
  assert.deepEqual(currentBudgetPeriod(new Date('2026-12-01T03:00:00Z')), { ano: 2026, mes: 12 });
  const message = budgetAlertEmail(snapshot, 'limiar', 'https://poup-eazy.vercel.app/redefinir-senha');
  assert.equal(message.to, snapshot.email);
  assert.match(message.text, /80%/);
  assert.match(message.text, /11\/2026/);
  assert.match(message.text, /https:\/\/poup-eazy\.vercel\.app\/perfil/);
  assert.doesNotMatch(message.text + message.html, /budget@example|synthetic|token=|\bIP\b/);
});

test('BUDGET-05 worker desativado nao consulta banco nem transporte', async () => {
  const worker = createBudgetEmailWorker({ enabled: false, database: { query: () => assert.fail('nao deve acessar banco') }, sendEmail: () => assert.fail('nao deve enviar') });
  assert.equal((await worker.runOnce()).sent, 0);
  worker.start(); worker.stop();
});

test('FINANCIAL-01 valores minimos validam centavos, limites e tipos para PATCH parcial', () => {
  for (const key of ['alerta_despesa_valor_minimo', 'alerta_receita_valor_minimo']) {
    for (const amount of [0.01, 100, 150.99, 9999999999.99]) assert.deepEqual(normalizeEmailPreferences({ [key]: amount }), { [key]: amount });
    for (const amount of [0, -1, 0.001, 1.999, 10000000000, Infinity, NaN, '100', null, false]) {
      assert.throws(() => normalizeEmailPreferences({ [key]: amount }), (error) => error.status === 422);
    }
  }
  for (const key of ['alerta_despesa_ativo', 'alerta_receita_ativo', 'alerta_meta_concluida_ativo']) {
    assert.deepEqual(normalizeEmailPreferences({ [key]: true }), { [key]: true });
    assert.throws(() => normalizeEmailPreferences({ [key]: 1 }));
  }
});

test('FINANCIAL-02 resumo agrupa quantidades e soma centavos sem nomes/IDs privados', () => {
  const rows = [
    { valor_evento: '100.01', valor_referencia: '100.00', data_exibicao: '27/11/2026', descricao: 'private-description', id: 'private-source' },
    { valor_evento: '100.02', valor_referencia: '100.00', data_exibicao: '27/11/2026' },
  ];
  const message = financialEventsEmail('owner@example.test', 'despesa', rows, 'https://poup-eazy.vercel.app/redefinir-senha');
  assert.match(message.subject, /2 despesas/);
  assert.match(message.text, /R\$ 200,03/);
  assert.match(message.html, /#0E5787/);
  assert.match(message.text, /\/perfil/);
  assert.doesNotMatch(message.text + message.html, /private-description|private-source|owner@example|token=/);
  const goals = financialEventsEmail('owner@example.test', 'meta_concluida', rows, 'https://poup-eazy.vercel.app/redefinir-senha');
  assert.match(goals.text, /Soma dos objetivos: R\$ 200,00/);
});

test('FINANCIAL-03 ambos workers desativados nao acessam dados nem abrem timers', async () => {
  const options = { enabled: false, database: { query: () => assert.fail('nao deve acessar banco') }, sendEmail: () => assert.fail('nao deve enviar') };
  assert.equal((await createFinancialEventEmailWorker(options).runOnce()).sent, 0);
  const worker = createEmailAlertsWorker(options);
  assert.equal((await worker.runOnce()).events.sent, 0);
  worker.start(); worker.stop();
});
