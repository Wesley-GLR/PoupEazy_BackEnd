const test = require('node:test');
const assert = require('node:assert/strict');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test',
  DATABASE_SSL: 'disable',
  JWT_SECRET: 'report-pluggy-tests-only-not-a-production-secret',
  PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
});

const {
  fetchAllItemTransactions,
  getOwnedIntegrationByItem,
  normalizePluggyTransaction,
  syncIntegration,
} = require('../src/services/pluggy.service');

const userId = 'b6fdfd35-3c12-4ff9-a61e-470f821b634b';
const integrationId = 'ca0bd9da-f216-4d86-b368-2f12e5ebad60';
const integration = { id: integrationId, id_usuario: userId, access_token_enc: 'synthetic-item', ativo: true, instituicao: 'Sandbox ficticio' };
const raw = (id, extra = {}) => ({ id, amount: -25, description: 'Mercado teste', date: '2026-10-15T12:00:00Z', status: 'POSTED', ...extra });
const account = { id: 'account-1', name: 'Conta sintetica' };

test('PLUGGY-01 normaliza credito explicito, pendente, data e descricao sem perder centavos', () => {
  const result = normalizePluggyTransaction(raw('credit-1', { type: 'CREDIT', amount: -42.51, status: 'PENDING', description: '  Receita teste  ' }), account);
  assert.equal(result.tipo, 'receita');
  assert.equal(result.valor, 42.51);
  assert.equal(result.status, 'pendente');
  assert.equal(result.data, '2026-10-15');
  assert.equal(result.descricao, 'Receita teste');
  assert.equal(result.accountId, account.id);
});

test('PLUGGY-02 rejeita identificador ausente, valor nao finito e data ilegivel do provedor', () => {
  assert.throws(() => normalizePluggyTransaction(raw(undefined), account), (error) => error.status === 502 && /identificador/.test(error.message));
  assert.throws(() => normalizePluggyTransaction(raw('invalid-value', { amount: 'abc' }), account), (error) => error.status === 502 && /valor invalido/.test(error.message));
  assert.throws(() => normalizePluggyTransaction(raw('invalid-date', { date: 'invalid-date' }), account), (error) => error.status === 502 && /data invalida/.test(error.message));
});

test('PLUGGY-03 busca todas as paginas e contas, deduplica IDs e ignora valor zero com SDK simulado', async () => {
  const calls = [];
  const client = {
    fetchAccounts: async (itemId) => { assert.equal(itemId, 'synthetic-item'); return { total: 2, results: [account, { id: 'account-2' }] }; },
    fetchTransactions: async (accountId, options) => {
      calls.push([accountId, options]);
      if (accountId === 'account-1' && options.page === 1) return { totalPages: 2, results: [raw('tx-1'), raw('zero', { amount: 0 })] };
      if (accountId === 'account-1') return { totalPages: 2, results: [raw('tx-1', { description: 'Versao atualizada' }), raw('tx-2')] };
      return { totalPages: 1, results: [raw('tx-3', { amount: 10, type: 'CREDIT' })] };
    },
  };
  const result = await fetchAllItemTransactions(client, 'synthetic-item');
  assert.equal(result.accounts.length, 2);
  assert.deepEqual(result.transactions.map((item) => item.id_externo), ['tx-1', 'tx-2', 'tx-3']);
  assert.equal(result.transactions[0].descricao, 'Versao atualizada');
  assert.equal(result.transactions[2].tipo, 'receita');
  assert.deepEqual(calls, [
    ['account-1', { page: 1, pageSize: 500 }],
    ['account-1', { page: 2, pageSize: 500 }],
    ['account-2', { page: 1, pageSize: 500 }],
  ]);
});

test('PLUGGY-04 usa fetchAllTransactions quando o SDK oferece coleta integral', async () => {
  const calls = [];
  const result = await fetchAllItemTransactions({
    fetchAccounts: async () => ({ results: [account] }),
    fetchAllTransactions: async (id) => { calls.push(id); return [raw('tx-all')]; },
    fetchTransactions: async () => { assert.fail('a coleta integral deve dispensar o fallback paginado'); },
  }, 'synthetic-item');
  assert.deepEqual(calls, [account.id]);
  assert.equal(result.transactions[0].id_externo, 'tx-all');
});

test('PLUGGY-05 rejeita contas incompletas e limite de transacoes excedido', async () => {
  await assert.rejects(fetchAllItemTransactions({ fetchAccounts: async () => ({ total: 2, results: [account] }) }, 'synthetic-item'), (error) => error.status === 502);
  await assert.rejects(fetchAllItemTransactions({
    fetchAccounts: async () => ({ results: [account] }),
    fetchAllTransactions: async () => [raw('tx-1'), raw('tx-2')],
  }, 'synthetic-item', 1), (error) => error.status === 422 && /limite de 1/.test(error.message));
});

test('PLUGGY-06 consulta conexao por dono/item/ativo e recusa item nao vinculado', async () => {
  let query;
  const database = { query: async (sql, values) => { query = { sql, values }; return { rows: [] }; } };
  await assert.rejects(getOwnedIntegrationByItem(database, userId, 'synthetic-item'), (error) => error.status === 404 && error.code === 'INTEGRATION_NOT_FOUND');
  assert.deepEqual(query.values, [userId, 'synthetic-item']);
  assert.match(query.sql, /id_usuario = \$1 AND access_token_enc = \$2 AND ativo = TRUE/);
});

test('PLUGGY-07 sincronizacao recusa conexao alheia/inativa antes de consultar o provedor', async () => {
  const database = {
    query: async (_sql, values) => { assert.deepEqual(values, [integrationId, userId]); return { rows: [] }; },
    getClient: async () => assert.fail('nao deve adquirir conexao SQL'),
  };
  const client = { fetchAccounts: async () => assert.fail('nao deve consultar provedor') };
  await assert.rejects(syncIntegration({ database, client, userId, integrationId }), (error) => error.status === 404);
});

test('PLUGGY-08 falha do provedor ocorre antes de abrir transacao SQL', async () => {
  const upstreamError = new Error('synthetic provider unavailable');
  const database = {
    query: async () => ({ rows: [integration] }),
    getClient: async () => assert.fail('falha de coleta nao deve abrir transacao'),
  };
  await assert.rejects(syncIntegration({ database, client: { fetchAccounts: async () => { throw upstreamError; } }, userId, integrationId }), (error) => error === upstreamError);
});

test('PLUGGY-09 erro SQL aciona ROLLBACK sem COMMIT e libera a conexao (banco simulado)', async () => {
  const calls = [];
  let released = false;
  const simulatedError = new Error('synthetic SQL failure');
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [] };
      if (/SELECT \* FROM open_finance_tokens/.test(sql)) return { rows: [integration] };
      if (/SELECT id, nome, tipo FROM categoria/.test(sql)) return { rows: [{ id: 'category-test', nome: 'Outros', tipo: 'despesa_variavel' }] };
      if (/INSERT INTO orcamento/.test(sql)) throw simulatedError;
      assert.fail(`consulta inesperada no teste: ${sql}`);
    },
    release: () => { released = true; },
  };
  const database = { query: async () => ({ rows: [integration] }), getClient: async () => connection };
  const client = { fetchAccounts: async () => ({ results: [account] }), fetchAllTransactions: async () => [raw('tx-1')] };
  await assert.rejects(syncIntegration({ database, client, userId, integrationId }), (error) => error === simulatedError);
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(released, true);
});

test('PLUGGY-10 alteracao da conexao durante coleta provoca conflito e rollback (banco simulado)', async () => {
  const calls = [];
  let released = false;
  const connection = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: sql.includes('FOR UPDATE') ? [{ ...integration, access_token_enc: 'changed-item' }] : [] };
    },
    release: () => { released = true; },
  };
  const database = { query: async () => ({ rows: [integration] }), getClient: async () => connection };
  const client = { fetchAccounts: async () => ({ results: [] }) };
  await assert.rejects(syncIntegration({ database, client, userId, integrationId }), (error) => error.status === 409);
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.includes('COMMIT'), false);
  assert.equal(released, true);
});
