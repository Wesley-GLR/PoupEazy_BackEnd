const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Opt-in only. Every execution creates and removes a NEW database in the
// explicitly selected disposable loopback PostgreSQL instance.
const explicitUrl = process.env.TEST_DATABASE_URL;
const sourceUrl = new URL(explicitUrl || 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test');
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/poupeazy_report_test') {
  throw new Error('TEST_DATABASE_URL deve apontar para loopback e banco descartavel poupeazy_report_test.');
}
const testDatabase = `poupeazy_report_test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl);
isolatedUrl.pathname = `/${testDatabase}`;
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: isolatedUrl.toString(), DATABASE_SSL: 'disable',
  JWT_SECRET: 'report-integration-tests-only-not-production',
  PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '', TRUST_PROXY: 'false',
});
const db = require('../src/db');
const { createApp } = require('../src/app');
const { syncIntegration } = require('../src/services/pluggy.service');
const { deleteAccount } = require('../src/services/account-deletion.service');

describe('PostgreSQL real + HTTP local (opt-in TEST_DATABASE_URL)', { skip: !explicitUrl }, () => {
  let admin;
  let server;
  let base;
  let created = false;
  let accountA;
  let accountB;
  let budgetA;
  let budgetB;
  let categoryA;
  let categoryB;
  let expenseCategory;
  let revenueCategory;
  let goalA;
  let goalB;
  let closedGoal;
  const password = 'SyntheticPassword123!';
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

  async function request(method, endpoint, body, token) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base}/api${endpoint}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }

  async function expectRequest(status, method, endpoint, body, token) {
    const result = await request(method, endpoint, body, token);
    assert.equal(result.status, status, `${method} ${endpoint}: ${JSON.stringify(result.body)}`);
    return result.body;
  }

  const budget = (account, mes, ano = 2026) => expectRequest(200, 'POST', '/orcamentos/get-or-create', { mes, ano }, account.token);
  const transaction = (overrides = {}) => ({
    id_orcamento: budgetA.id, id_categoria: expenseCategory.id,
    valor: 25.50, data_transacao: '2026-10-15', descricao: 'Despesa sintetica', tipo: 'despesa', ...overrides,
  });
  async function databaseAmount(table, id, column) {
    assert.ok(['orcamento', 'metas'].includes(table));
    assert.ok(['valor_real', 'valor_atual'].includes(column));
    return Number((await db.query(`SELECT ${column} AS value FROM ${table} WHERE id = $1`, [id])).rows[0].value);
  }

  before(async () => {
    admin = new Pool({ connectionString: sourceUrl.toString(), ssl: false, connectionTimeoutMillis: 5000 });
    assert.match(testDatabase, /^poupeazy_report_test_[0-9]+_[0-9a-f]{8}$/);
    await admin.query(`CREATE DATABASE "${testDatabase}"`);
    created = true;
    await db.query(schema);
    server = createApp().listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    base = `http://127.0.0.1:${server.address().port}`;
    accountA = await expectRequest(201, 'POST', '/auth/register', { email: 'account.a@example.test', password, nome: 'Pessoa A sintetica' });
    accountB = await expectRequest(201, 'POST', '/auth/register', { email: 'account.b@example.test', password, nome: 'Pessoa B sintetica' });
    budgetA = await budget(accountA, 10);
    budgetB = await budget(accountB, 10);
    const categories = await expectRequest(200, 'GET', '/categorias', undefined, accountA.token);
    expenseCategory = categories.find((item) => item.nome === 'Alimentação' && item.sistema);
    revenueCategory = categories.find((item) => item.nome === 'Salário' && item.sistema);
    assert.ok(expenseCategory && revenueCategory);
    categoryA = await expectRequest(201, 'POST', '/categorias', { nome: 'Categoria privada A', tipo: 'despesa_variavel' }, accountA.token);
    categoryB = await expectRequest(201, 'POST', '/categorias', { nome: 'Categoria privada B', tipo: 'despesa_variavel' }, accountB.token);
    goalA = await expectRequest(201, 'POST', '/metas', { nome: 'Meta A', valor_objetivo: 1000, data_limite: '2027-12-31' }, accountA.token);
    goalB = await expectRequest(201, 'POST', '/metas', { nome: 'Meta B', valor_objetivo: 1000, data_limite: '2027-12-31' }, accountB.token);
    closedGoal = await expectRequest(201, 'POST', '/metas', { nome: 'Meta encerrada', valor_objetivo: 1000, data_limite: '2027-12-31', status: 'concluida' }, accountA.token);
    console.log(`POSTGRES_TEST_DATABASE=${testDatabase}; loopback; schema real; dados exclusivamente sinteticos`);
  });

  after(async () => {
    if (server) await new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.pool.end();
    if (created) await admin.query(`DROP DATABASE "${testDatabase}"`);
    if (admin) await admin.end();
  });

  test('DB-01 schema e migration mobile reaplicados preservam 11 categorias nativas sem duplicatas', async () => {
    await db.query(schema);
    const migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '004_mobile_security_open_finance.sql'), 'utf8');
    await db.query(migration);
    await db.query(migration);
    const counts = await db.query('SELECT COUNT(*)::int AS total, COUNT(DISTINCT (nome, tipo))::int AS unique_total FROM categoria WHERE sistema = TRUE');
    assert.deepEqual(counts.rows[0], { total: 11, unique_total: 11 });
    const fk = await db.query("SELECT 1 FROM pg_constraint WHERE conname = 'despesas_id_integracao_fkey'");
    assert.equal(fk.rowCount, 1);
  });

  test('DB-02 cadastro persiste bcrypt e perfil, sem devolver hash no DTO publico', async () => {
    assert.equal(accountA.profile.id, accountA.user.id);
    assert.equal(accountA.profile.nome, 'Pessoa A sintetica');
    assert.equal('senha_hash' in accountA.user, false);
    const stored = (await db.query('SELECT senha_hash FROM usuarios WHERE id = $1', [accountA.user.id])).rows[0];
    assert.notEqual(stored.senha_hash, password);
    assert.equal(await bcrypt.compare(password, stored.senha_hash), true);
  });

  test('DB-03 login normaliza email; senha incorreta e cadastro duplicado sao recusados', async () => {
    const login = await expectRequest(200, 'POST', '/auth/login', { email: '  ACCOUNT.A@EXAMPLE.TEST ', password });
    assert.equal(login.user.id, accountA.user.id);
    await expectRequest(401, 'POST', '/auth/login', { email: accountA.user.email, password: 'incorrect-synthetic-password' });
    await expectRequest(409, 'POST', '/auth/register', { email: 'ACCOUNT.A@EXAMPLE.TEST', password });
  });

  test('DB-04 JWT autentica me e alteracao de perfil nao modifica a outra conta', async () => {
    const me = await expectRequest(200, 'GET', '/auth/me', undefined, accountA.token);
    assert.equal(me.user.id, accountA.user.id);
    await expectRequest(200, 'PATCH', '/profile', { nome: 'Pessoa A atualizada' }, accountA.token);
    const other = await expectRequest(200, 'GET', '/profile', undefined, accountB.token);
    assert.equal(other.nome, 'Pessoa B sintetica');
  });

  test('DB-05 get-or-create preserva unico orcamento; limites invalidos sao recusados', async () => {
    assert.equal((await budget(accountA, 10)).id, budgetA.id);
    const count = await db.query('SELECT COUNT(*)::int AS total FROM orcamento WHERE id_usuario = $1 AND mes = 10 AND ano = 2026', [accountA.user.id]);
    assert.equal(count.rows[0].total, 1);
    await expectRequest(422, 'POST', '/orcamentos', { mes: 13, ano: 2026 }, accountA.token);
    await expectRequest(422, 'PATCH', `/orcamentos/${budgetA.id}`, { valor_planejado: -1 }, accountA.token);
  });

  test('DB-06 listas e escritas preservam isolamento entre duas contas reais', async () => {
    const goals = await expectRequest(200, 'GET', '/metas', undefined, accountB.token);
    assert.equal(goals.some((item) => item.id === goalA.id), false);
    const categories = await expectRequest(200, 'GET', '/categorias', undefined, accountB.token);
    assert.equal(categories.some((item) => item.id === categoryA.id), false);
    await expectRequest(404, 'PATCH', `/metas/${goalA.id}`, { nome: 'Tentativa indevida' }, accountB.token);
    await expectRequest(404, 'DELETE', `/metas/${goalA.id}`, undefined, accountB.token);
    await expectRequest(404, 'PATCH', `/orcamentos/${budgetA.id}`, { valor_planejado: 500 }, accountB.token);
    await expectRequest(404, 'DELETE', `/categorias/${categoryA.id}`, undefined, accountB.token);
  });

  test('DB-07 referencias a orcamento, categoria e meta de outra conta sao recusadas', async () => {
    for (const [input, code] of [
      [transaction({ id_orcamento: budgetB.id }), 'BUDGET_FORBIDDEN'],
      [transaction({ id_categoria: categoryB.id }), 'CATEGORY_FORBIDDEN'],
      [transaction({ id_metas: goalB.id }), 'GOAL_FORBIDDEN'],
    ]) {
      const result = await expectRequest(403, 'POST', '/despesas', input, accountA.token);
      assert.equal(result.code, code);
    }
  });

  test('DB-08 tipo/categoria, mes do orcamento e meta encerrada validam regras reais', async () => {
    for (const [input, code] of [
      [transaction({ id_categoria: revenueCategory.id }), 'CATEGORY_TYPE_MISMATCH'],
      [transaction({ data_transacao: '2026-11-15' }), 'BUDGET_DATE_MISMATCH'],
      [transaction({ id_metas: closedGoal.id }), 'GOAL_NOT_ACTIVE'],
    ]) {
      const result = await expectRequest(422, 'POST', '/despesas', input, accountA.token);
      assert.equal(result.code, code);
    }
  });

  test('DB-09 CRUD de transacoes recalcula totais, ignora pendentes e isola exclusao', async () => {
    const target = await budget(accountA, 11);
    const expense = await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: target.id, data_transacao: '2026-11-15', valor: 100 }), accountA.token);
    const income = await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: target.id, data_transacao: '2026-11-15', tipo: 'receita', id_categoria: revenueCategory.id, valor: 30 }), accountA.token);
    await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: target.id, data_transacao: '2026-11-15', status: 'pendente', valor: 9 }), accountA.token);
    assert.equal(await databaseAmount('orcamento', target.id, 'valor_real'), 70);
    const hidden = await expectRequest(200, 'GET', '/despesas', undefined, accountB.token);
    assert.equal(hidden.some((item) => item.id === expense.id), false);
    await expectRequest(404, 'PATCH', `/despesas/${expense.id}`, { valor: 999 }, accountB.token);
    await expectRequest(404, 'DELETE', `/despesas/${expense.id}`, undefined, accountB.token);
    await expectRequest(200, 'PATCH', `/despesas/${expense.id}`, { valor: 120 }, accountA.token);
    assert.equal(await databaseAmount('orcamento', target.id, 'valor_real'), 90);
    await expectRequest(204, 'DELETE', `/despesas/${expense.id}`, undefined, accountA.token);
    assert.equal(await databaseAmount('orcamento', target.id, 'valor_real'), -30);
    await expectRequest(204, 'DELETE', `/despesas/${income.id}`, undefined, accountA.token);
    assert.equal(await databaseAmount('orcamento', target.id, 'valor_real'), 0);
  });

  test('DB-10 aporte/retirada e PATCH null recalculam saldo da meta via trigger real', async () => {
    const target = await budget(accountA, 12);
    const common = { id_orcamento: target.id, data_transacao: '2026-12-15', id_metas: goalA.id };
    const deposit = await expectRequest(201, 'POST', '/despesas', transaction({ ...common, valor: 250 }), accountA.token);
    const withdrawal = await expectRequest(201, 'POST', '/despesas', transaction({ ...common, tipo: 'receita', id_categoria: revenueCategory.id, valor: 50 }), accountA.token);
    assert.equal(await databaseAmount('metas', goalA.id, 'valor_atual'), 200);
    await expectRequest(200, 'PATCH', `/despesas/${deposit.id}`, { id_metas: null }, accountA.token);
    assert.equal(await databaseAmount('metas', goalA.id, 'valor_atual'), -50);
    await expectRequest(200, 'PATCH', `/despesas/${deposit.id}`, { id_metas: goalA.id }, accountA.token);
    assert.equal(await databaseAmount('metas', goalA.id, 'valor_atual'), 200);
    await expectRequest(204, 'DELETE', `/despesas/${withdrawal.id}`, undefined, accountA.token);
    assert.equal(await databaseAmount('metas', goalA.id, 'valor_atual'), 250);
  });

  test('DB-11 mover transacao de mes atualiza orcamento antigo e novo', async () => {
    const from = await budget(accountA, 1);
    const to = await budget(accountA, 2);
    const item = await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: from.id, data_transacao: '2026-01-15', valor: 80 }), accountA.token);
    await expectRequest(200, 'PATCH', `/despesas/${item.id}`, { id_orcamento: to.id, data_transacao: '2026-02-15' }, accountA.token);
    assert.equal(await databaseAmount('orcamento', from.id, 'valor_real'), 0);
    assert.equal(await databaseAmount('orcamento', to.id, 'valor_real'), 80);
  });

  test('DB-12 filtros/paginacao preservam contrato legado e contagens reais', async () => {
    const target = await budget(accountA, 3);
    for (const [description, value] of [['Filtro especial A', 10], ['Filtro especial B', 20], ['Outro item', 30]]) {
      await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: target.id, data_transacao: '2026-03-15', descricao: description, valor: value }), accountA.token);
    }
    const query = '/despesas?q=Filtro%20especial&data_inicio=2026-03-01&data_fim=2026-03-31';
    const legacy = await expectRequest(200, 'GET', query, undefined, accountA.token);
    assert.equal(Array.isArray(legacy), true);
    assert.equal(legacy.length, 2);
    const paginated = await expectRequest(200, 'GET', `${query}&page=2&limit=1`, undefined, accountA.token);
    assert.equal(paginated.data.length, 1);
    assert.deepEqual(paginated.pagination, { page: 2, limit: 1, total: 2, totalPages: 2 });
    const invalid = await expectRequest(422, 'GET', '/despesas?data_inicio=2026-10-31&data_fim=2026-10-01', undefined, accountA.token);
    assert.match(invalid.error, /posterior/);
  });

  test('DB-13 categorias nativas e categorias em uso respeitam protecoes reais', async () => {
    await expectRequest(404, 'PATCH', `/categorias/${expenseCategory.id}`, { nome: 'Alteracao indevida' }, accountA.token);
    await expectRequest(404, 'DELETE', `/categorias/${expenseCategory.id}`, undefined, accountA.token);
    const item = await expectRequest(201, 'POST', '/despesas', transaction({ id_categoria: categoryA.id }), accountA.token);
    await expectRequest(409, 'PATCH', `/categorias/${categoryA.id}`, { tipo: 'receita' }, accountA.token);
    await expectRequest(409, 'DELETE', `/categorias/${categoryA.id}`, undefined, accountA.token);
    await expectRequest(204, 'DELETE', `/despesas/${item.id}`, undefined, accountA.token);
    await expectRequest(204, 'DELETE', `/categorias/${categoryA.id}`, undefined, accountA.token);
  });

  test('DB-14 recuperacao local valida expiracao, uso unico e senha antiga/nova sem envio de email', async () => {
    const email = 'reset.account@example.test';
    const createdAccount = await expectRequest(201, 'POST', '/auth/register', { email, password });
    const unknown = await expectRequest(200, 'POST', '/auth/forgot-password', { email: 'unknown@example.test' });
    assert.equal('resetToken' in unknown, false);
    const first = await expectRequest(200, 'POST', '/auth/forgot-password', { email });
    assert.equal(typeof first.resetToken, 'string');
    await db.query("UPDATE usuarios SET reset_expira_em = NOW() - INTERVAL '1 second' WHERE id = $1", [createdAccount.user.id]);
    await expectRequest(400, 'POST', '/auth/reset-password', { token: first.resetToken, novaSenha: 'NewSyntheticPassword123!' });
    const valid = await expectRequest(200, 'POST', '/auth/forgot-password', { email });
    await expectRequest(200, 'POST', '/auth/reset-password', { token: valid.resetToken, novaSenha: 'NewSyntheticPassword123!' });
    await expectRequest(400, 'POST', '/auth/reset-password', { token: valid.resetToken, novaSenha: 'AnotherSyntheticPassword123!' });
    await expectRequest(401, 'POST', '/auth/login', { email, password });
    const login = await expectRequest(200, 'POST', '/auth/login', { email, password: 'NewSyntheticPassword123!' });
    assert.equal(login.user.id, createdAccount.user.id);
  });

  test('DB-15 sincronizacao usa PostgreSQL real e SDK simulado: duas contas, dois meses e idempotencia', async () => {
    const integration = (await db.query("INSERT INTO open_finance_tokens (id_usuario, instituicao, access_token_enc, expira_em) VALUES ($1, 'Banco sintetico SQL', 'synthetic-sql-item', NOW() + INTERVAL '1 day') RETURNING *", [accountA.user.id])).rows[0];
    const firstAccount = { id: 'synthetic-checking' };
    const secondAccount = { id: 'synthetic-savings' };
    const client = {
      fetchAccounts: async () => ({ total: 2, results: [firstAccount, secondAccount] }),
      fetchAllTransactions: async (id) => id === firstAccount.id ? [
        { id: 'sql-debit', amount: -42.50, type: 'DEBIT', date: '2025-10-15', description: 'Mercado sintetico', status: 'POSTED' },
        { id: 'sql-pending', amount: -4, type: 'DEBIT', date: '2025-10-16', description: 'Pendente sintetica', status: 'PENDING' },
      ] : [{ id: 'sql-credit', amount: 12.50, type: 'CREDIT', date: '2025-11-15', description: 'Receita sintetica', status: 'POSTED' }],
    };
    const first = await syncIntegration({ database: db, client, userId: accountA.user.id, integrationId: integration.id });
    assert.deepEqual([first.accounts, first.found, first.inserted, first.updated, first.unchanged, first.budgetsCreated], [2, 3, 3, 0, 0, 2]);
    const second = await syncIntegration({ database: db, client, userId: accountA.user.id, integrationId: integration.id });
    assert.deepEqual([second.inserted, second.updated, second.unchanged, second.budgetsCreated], [0, 0, 3, 0]);
    const stored = await db.query('SELECT id_externo, origem FROM despesas WHERE id_integracao = $1', [integration.id]);
    assert.equal(stored.rowCount, 3);
    assert.ok(stored.rows.every((item) => item.origem === 'open_finance'));
    const totals = await db.query('SELECT mes, valor_real FROM orcamento WHERE id_usuario = $1 AND ano = 2025 ORDER BY mes', [accountA.user.id]);
    assert.deepEqual(totals.rows.map((row) => [row.mes, Number(row.valor_real)]), [[10, 42.5], [11, -12.5]]);
  });

  test('DB-16 erro apos uma insercao desfaz transacao e orcamento inteiro no PostgreSQL real', async () => {
    const integration = (await db.query("INSERT INTO open_finance_tokens (id_usuario, instituicao, access_token_enc, expira_em) VALUES ($1, 'Banco rollback', 'synthetic-rollback-item', NOW() + INTERVAL '1 day') RETURNING *", [accountB.user.id])).rows[0];
    const client = {
      fetchAccounts: async () => ({ results: [{ id: 'rollback-account' }] }),
      fetchAllTransactions: async () => [
        { id: 'rollback-valid', amount: -10, date: '2024-01-15', description: 'Antes da falha' },
        { id: 'rollback-invalid', amount: -20, date: '1999-01-15', description: 'Ano fora do limite' },
      ],
    };
    await assert.rejects(syncIntegration({ database: db, client, userId: accountB.user.id, integrationId: integration.id }), (error) => error.status === 422);
    assert.equal((await db.query('SELECT 1 FROM despesas WHERE id_integracao = $1', [integration.id])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM orcamento WHERE id_usuario = $1 AND ano = 2024', [accountB.user.id])).rowCount, 0);
    assert.equal((await db.query('SELECT ultimo_uso FROM open_finance_tokens WHERE id = $1', [integration.id])).rows[0].ultimo_uso, null);
  });

  test('DB-17 exclusao publica apaga dados associados, preserva outra conta e invalida JWT', async () => {
    async function seed(name, phone) {
      const account = await expectRequest(201, 'POST', '/auth/register', { email: `${name}@example.test`, password });
      const ownedBudget = await budget(account, 4);
      const category = await expectRequest(201, 'POST', '/categorias', { nome: name, tipo: 'despesa_variavel' }, account.token);
      const goal = await expectRequest(201, 'POST', '/metas', { nome: name, valor_objetivo: 100, data_limite: '2027-12-31' }, account.token);
      // IDs legados repetidos nao autorizam apagar itens no provedor externo.
      const integration = (await db.query("INSERT INTO open_finance_tokens (id_usuario, instituicao, access_token_enc, expira_em) VALUES ($1, 'Sandbox exclusao', 'shared-legacy-item-id', NOW() + INTERVAL '1 day') RETURNING id", [account.user.id])).rows[0];
      const expense = await expectRequest(201, 'POST', '/despesas', {
        id_orcamento: ownedBudget.id, id_categoria: category.id, id_metas: goal.id,
        valor: 20, data_transacao: '2026-04-15', tipo: 'despesa',
      }, account.token);
      await db.query('UPDATE despesas SET id_integracao = $1 WHERE id = $2', [integration.id, expense.id]);
      await db.query("INSERT INTO notificacoes (id_usuario, tipo, titulo, mensagem) VALUES ($1, 'relatorio', 'Sintetico', 'Sintetico')", [account.user.id]);
      const link = (await db.query('INSERT INTO whatsapp_vinculos (id_usuario, wa_id, pendencia) VALUES ($1, $2, $3) RETURNING id', [account.user.id, phone, { description: 'Sintetico' }])).rows[0];
      await db.query("INSERT INTO whatsapp_codigos (id_usuario, codigo_hash, expira_em) VALUES ($1, $2, NOW() + INTERVAL '1 hour')", [account.user.id, crypto.createHash('sha256').update(name).digest('hex')]);
      await db.query('INSERT INTO whatsapp_mensagens (id, id_vinculo, resposta, relatorio) VALUES ($1, $2, $3, $4)', [`delete-test-${name}`, link.id, 'Sintetico', { gastos: 20 }]);
      await db.query("UPDATE usuarios SET reset_token = 'synthetic-reset-token', reset_expira_em = NOW() + INTERVAL '1 hour' WHERE id = $1", [account.user.id]);
      return { account, budget: ownedBudget, category, goal, integration, expense, link };
    }
    const removed = await seed('delete-owner', '5511999991001');
    const kept = await seed('delete-other', '5511999991002');
    const systemCount = (await db.query('SELECT COUNT(*)::int AS total FROM categoria WHERE sistema = TRUE')).rows[0].total;
    const body = { email: removed.account.user.email, password, confirmacao: 'EXCLUIR' };
    await expectRequest(400, 'POST', '/auth/delete-account', { ...body, confirmacao: 'nao' });
    const unknown = await expectRequest(401, 'POST', '/auth/delete-account', { ...body, email: 'delete-missing@example.test' });
    const wrong = await expectRequest(401, 'POST', '/auth/delete-account', { ...body, password: 'wrong-password' });
    assert.deepEqual(wrong, unknown);
    assert.equal((await db.query('SELECT 1 FROM usuarios WHERE id = $1', [removed.account.user.id])).rowCount, 1);

    await expectRequest(200, 'POST', '/auth/delete-account', body);
    for (const table of ['usuarios', 'profiles', 'orcamento', 'categoria', 'metas', 'open_finance_tokens', 'notificacoes', 'whatsapp_codigos', 'whatsapp_vinculos']) {
      const column = ['usuarios', 'profiles'].includes(table) ? 'id' : 'id_usuario';
      assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [removed.account.user.id])).rowCount, 0, table);
      assert.ok((await db.query(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [kept.account.user.id])).rowCount > 0, `preserva ${table}`);
    }
    assert.equal((await db.query('SELECT 1 FROM despesas WHERE id = $1', [removed.expense.id])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM despesas WHERE id = $1', [kept.expense.id])).rowCount, 1);
    assert.equal((await db.query('SELECT 1 FROM whatsapp_mensagens WHERE id_vinculo = $1', [removed.link.id])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM whatsapp_mensagens WHERE id_vinculo = $1', [kept.link.id])).rowCount, 1);
    assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM categoria WHERE sistema = TRUE')).rows[0].total, systemCount);
    await expectRequest(401, 'GET', '/metas', undefined, removed.account.token);
    await expectRequest(401, 'POST', '/auth/login', { email: body.email, password });
    await expectRequest(401, 'POST', '/auth/delete-account', body);
    await expectRequest(200, 'GET', '/metas', undefined, kept.account.token);
  });

  test('DB-18 falha SQL no fim da exclusao restaura a conta e suas despesas', async () => {
    const account = await expectRequest(201, 'POST', '/auth/register', { email: 'delete-rollback@example.test', password });
    const ownedBudget = await budget(account, 5);
    const expense = await expectRequest(201, 'POST', '/despesas', transaction({ id_orcamento: ownedBudget.id, data_transacao: '2026-05-15' }), account.token);
    await db.query(`CREATE FUNCTION test_block_account_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.email = 'delete-rollback@example.test' THEN RAISE EXCEPTION 'synthetic-delete-failure'; END IF;
        RETURN OLD;
      END;
      $$;
      CREATE TRIGGER test_block_account_delete BEFORE DELETE ON usuarios FOR EACH ROW EXECUTE FUNCTION test_block_account_delete()`);
    try {
      await assert.rejects(deleteAccount({ database: db, email: account.user.email, password }), /synthetic-delete-failure/);
      assert.equal((await db.query('SELECT 1 FROM usuarios WHERE id = $1', [account.user.id])).rowCount, 1);
      assert.equal((await db.query('SELECT 1 FROM despesas WHERE id = $1', [expense.id])).rowCount, 1);
      assert.equal(await databaseAmount('orcamento', ownedBudget.id, 'valor_real'), 25.50);
      await expectRequest(200, 'GET', '/metas', undefined, account.token);
    } finally {
      await db.query('DROP TRIGGER test_block_account_delete ON usuarios; DROP FUNCTION test_block_account_delete()');
    }
  });
});
