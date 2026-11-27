require('../test-support/safe-env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const explicitUrl = process.env.TEST_DATABASE_URL;
const sourceUrl = new URL(explicitUrl || 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test');
if (!['127.0.0.1', 'localhost'].includes(sourceUrl.hostname) || sourceUrl.pathname !== '/poupeazy_report_test') {
  throw new Error('TEST_DATABASE_URL deve apontar para loopback e banco descartavel poupeazy_report_test.');
}
const databaseName = `poupeazy_report_test_budget_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const isolatedUrl = new URL(sourceUrl); isolatedUrl.pathname = `/${databaseName}`;
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: isolatedUrl.toString(), DATABASE_SSL: 'disable',
  JWT_SECRET: 'budget-integration-tests-only-not-production',
});
const db = require('../src/db');
const { createApp } = require('../src/app');
const { gerarToken } = require('../src/middleware/auth');
const { createBudgetEmailWorker } = require('../src/services/budget-email.service');
const { updateEmailPreferences, DEFAULTS } = require('../src/services/email-preferences.service');
const { deleteAccount } = require('../src/services/account-deletion.service');
const { GmailEmailError } = require('../src/config/email');

describe('Alertas de orcamento + PostgreSQL real descartavel', { skip: !explicitUrl }, () => {
  let admin, server, base, expenseCategory, revenueCategory;
  let created = false;
  const password = 'SyntheticBudgetPassword123!';
  const passwordHash = bcrypt.hashSync(password, 4);
  const migration = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/008_budget_email_alerts.sql'), 'utf8');
  const messages = [];
  const options = { database: db, enabled: true, resetUrl: 'https://poup-eazy.vercel.app/redefinir-senha', now: () => new Date('2026-11-27T15:00:00Z') };
  const worker = (sendEmail = async message => { messages.push(message); }, database = db) => createBudgetEmailWorker({ ...options, database, sendEmail });

  async function request(method, body, user) {
    const response = await fetch(`${base}/api/preferencias-email`, {
      method, headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${gerarToken(user)}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  async function account(verified = true) {
    const email = `budget.${crypto.randomUUID()}@example.test`;
    const { rows: [user] } = await db.query(
      `INSERT INTO usuarios (email, senha_hash, email_verificacao_obrigatoria, email_verificado_em)
       VALUES ($1,$2,FALSE,CASE WHEN $3 THEN NOW() ELSE NULL END) RETURNING *`, [email, passwordHash, verified]);
    await db.query('INSERT INTO profiles (id, nome) VALUES ($1,$2)', [user.id, 'Pessoa sintetica']);
    return user;
  }
  async function budget(user, planned = '100.00', mes = 11) {
    const { rows: [row] } = await db.query('INSERT INTO orcamento (id_usuario,ano,mes,valor_planejado) VALUES ($1,2026,$2,$3) RETURNING *', [user.id, mes, planned]);
    return row;
  }
  async function expense(monthlyBudget, value, { tipo = 'despesa', status = 'confirmada', origem = 'manual', id_externo = null } = {}) {
    const { rows: [row] } = await db.query(
      `INSERT INTO despesas (id_orcamento,id_categoria,valor,data_transacao,descricao,tipo,status,origem,id_externo)
       VALUES ($1,$2,$3,$4,'Lancamento sintetico',$5,$6,$7,$8) RETURNING *`,
      [monthlyBudget.id, tipo === 'receita' ? revenueCategory : expenseCategory, value,
        `2026-${String(monthlyBudget.mes).padStart(2, '0')}-15`, tipo, status, origem, id_externo]);
    return row;
  }
  const enable = (user, percentage = 80) => updateEmailPreferences(db, user.id, { alerta_orcamento_ativo: true, alerta_orcamento_percentual: percentage });
  const notices = user => messages.filter(message => message.to === user.email);
  const events = async user => (await db.query('SELECT tipo,estado FROM email_alertas_orcamento WHERE id_usuario=$1 ORDER BY tipo', [user.id])).rows;

  before(async () => {
    admin = new Pool({ connectionString: sourceUrl.toString(), ssl: false });
    assert.match(databaseName, /^poupeazy_report_test_budget_\d+_[0-9a-f]{8}$/);
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    await db.query(fs.readFileSync(path.join(__dirname, '..', 'db/schema.sql'), 'utf8'));
    await db.query(migration); await db.query(migration);
    expenseCategory = (await db.query("SELECT id FROM categoria WHERE sistema=TRUE AND tipo='despesa_variavel' LIMIT 1")).rows[0].id;
    revenueCategory = (await db.query("SELECT id FROM categoria WHERE sistema=TRUE AND tipo='receita' LIMIT 1")).rows[0].id;
    server = createApp({ sendEmail: async () => assert.fail('rotas de preferencias nao enviam email') }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
    await db.pool.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    if (admin) await admin.end();
  });

  test('BUDGET-DB-01 contrato HTTP, isolamento e conta antiga sem confirmacao', async () => {
    const legacy = await account(false); const other = await account();
    assert.equal((await request('GET')).status, 401);
    assert.deepEqual((await request('GET', undefined, legacy)).body, { ...DEFAULTS, email_verificado: false });
    const rejected = await request('PATCH', { alerta_orcamento_ativo: true }, legacy);
    assert.equal(rejected.status, 403); assert.equal(rejected.body.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await request('PATCH', { alerta_orcamento_percentual: 1 }, legacy)).status, 200);
    assert.equal((await request('PATCH', { alerta_orcamento_ativo: false }, legacy)).status, 200);
    assert.equal((await request('PATCH', { id_usuario: other.id, alerta_orcamento_ativo: true }, legacy)).status, 400);
    assert.equal((await request('GET', undefined, other)).body.alerta_orcamento_percentual, 80);
    await db.query('UPDATE usuarios SET email_verificado_em=NOW() WHERE id=$1', [legacy.id]);
    assert.equal((await request('PATCH', { alerta_orcamento_ativo: true, alerta_orcamento_percentual: 100 }, legacy)).status, 200);
    assert.equal((await request('GET', undefined, legacy)).body.email_verificado, true);
  });

  test('BUDGET-DB-02 despesas brutas confirmadas, limites exatos e deduplicacao persistida', async () => {
    const user = await account(); const monthly = await budget(user); await enable(user);
    const spending = await expense(monthly, '79.99');
    await expense(monthly, '500.00', { tipo: 'receita' });
    await expense(monthly, '999.00', { status: 'pendente' });
    await expense(monthly, '999.00', { status: 'cancelada' });
    await worker().runOnce(); assert.equal(notices(user).length, 0);
    await expense(monthly, '0.01', { origem: 'chatbot' });
    await worker().runOnce(); assert.equal(notices(user).length, 1); assert.match(notices(user)[0].text, /80%/);
    await db.query('UPDATE despesas SET valor=99.99 WHERE id=$1', [spending.id]);
    await worker().runOnce(); assert.equal(notices(user).length, 1, '100% exatos nao sao excesso');
    await expense(monthly, '0.01', { origem: 'open_finance', id_externo: 'synthetic-external-1' });
    await worker().runOnce(); await worker().runOnce();
    assert.equal(notices(user).length, 2);
    assert.deepEqual(await events(user), [{ tipo: 'excesso', estado: 'enviado' }, { tipo: 'limiar', estado: 'enviado' }]);
    await updateEmailPreferences(db, user.id, { alerta_orcamento_ativo: false });
    await enable(user, 1); await worker().runOnce(); assert.equal(notices(user).length, 2);
    await db.query(migration); assert.equal((await events(user)).length, 2);
  });

  test('BUDGET-DB-03 salto direto consolida; recriar orcamento nao rearma avisos', async () => {
    const user = await account(); let monthly = await budget(user); await enable(user);
    await expense(monthly, '150.00'); await worker().runOnce();
    assert.equal(notices(user).length, 1);
    assert.deepEqual(await events(user), [{ tipo: 'excesso', estado: 'enviado' }, { tipo: 'limiar', estado: 'coberto' }]);
    await db.query('DELETE FROM despesas WHERE id_orcamento=$1', [monthly.id]);
    await db.query('DELETE FROM orcamento WHERE id=$1', [monthly.id]);
    monthly = await budget(user); await expense(monthly, '200.00'); await worker().runOnce();
    assert.equal(notices(user).length, 1);
  });

  test('BUDGET-DB-04 percentual100, competencia atual e orcamentozero', async () => {
    const user = await account(); const monthly = await budget(user); await enable(user, 100);
    await expense(monthly, '100.00'); await worker().runOnce(); assert.equal(notices(user).length, 1);
    await expense(monthly, '0.01'); await worker().runOnce(); assert.equal(notices(user).length, 2);
    const zero = await account(); await enable(zero); await expense(await budget(zero, '0'), '150');
    const historic = await account(); await enable(historic); await expense(await budget(historic, '100', 10), '150');
    await expense(await budget(historic, '100', 12), '150'); await worker().runOnce();
    assert.equal(notices(zero).length, 0); assert.equal(notices(historic).length, 0);
  });

  test('BUDGET-DB-05 workers simultaneos reservam apenas um aviso consolidado', async () => {
    const user = await account(); await enable(user); await expense(await budget(user), '150');
    await Promise.all([worker().runOnce(), worker().runOnce()]);
    assert.equal(notices(user).length, 1); assert.equal((await events(user)).length, 2);
  });

  test('BUDGET-DB-06 falha e resultado incerto nao repetem transporte; reservas antigas sao encerradas', async t => {
    const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
    const failed = await account(); await enable(failed); await expense(await budget(failed), '80');
    let attempts = 0;
    await worker(async () => { attempts++; throw new GmailEmailError('EMAIL_RATE_LIMITED'); }).runOnce();
    await worker().runOnce(); assert.equal(attempts, 1); assert.equal(notices(failed).length, 0);
    assert.deepEqual(await events(failed), [{ tipo: 'limiar', estado: 'falhou' }]);
    const uncertain = await account(); await enable(uncertain); await expense(await budget(uncertain), '80');
    await worker(async () => { throw new Error('private-secret-not-for-log'); }).runOnce();
    await worker().runOnce(); assert.equal(notices(uncertain).length, 0);
    assert.deepEqual(await events(uncertain), [{ tipo: 'limiar', estado: 'incerto' }]);
    await db.query("UPDATE email_alertas_orcamento SET estado='reservado',atualizado_em=NOW()-INTERVAL '3 minutes' WHERE id_usuario=$1", [uncertain.id]);
    await worker().runOnce(); assert.deepEqual(await events(uncertain), [{ tipo: 'limiar', estado: 'incerto' }]);
    assert.ok(logs.includes('[budget-email] EMAIL_RATE_LIMITED')); assert.ok(logs.includes('[budget-email] EMAIL_SEND_UNKNOWN'));
    assert.ok(logs.every(value => !value.includes('private-secret')));
  });

  test('BUDGET-DB-07 desativacao e exclusao entre reserva e envio sao respeitadas', async () => {
    const user = await account(); await enable(user); await expense(await budget(user), '80');
    let intercepted = false;
    const wrapped = { getClient: db.getClient, query: async (sql, values) => {
      if (sql.includes('budget-email:revalidate') && !intercepted) { intercepted = true; await updateEmailPreferences(db, user.id, { alerta_orcamento_ativo: false }); }
      return db.query(sql, values);
    } };
    await worker(undefined, wrapped).runOnce(); assert.equal(notices(user).length, 0);
    assert.deepEqual(await events(user), [{ tipo: 'limiar', estado: 'cancelado' }]);
    await deleteAccount({ database: db, email: user.email, password });
    assert.equal((await db.query('SELECT * FROM preferencias_email WHERE id_usuario=$1', [user.id])).rowCount, 0);
    assert.equal((await events(user)).length, 0);
    const deleted = await account(); await enable(deleted); await expense(await budget(deleted), '80');
    intercepted = false;
    wrapped.query = async (sql, values) => {
      if (sql.includes('budget-email:revalidate') && !intercepted) { intercepted = true; await deleteAccount({ database: db, email: deleted.email, password }); }
      return db.query(sql, values);
    };
    await worker(undefined, wrapped).runOnce(); assert.equal(notices(deleted).length, 0);
    assert.equal((await events(deleted)).length, 0);
  });
});
