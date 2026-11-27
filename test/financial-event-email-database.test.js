require('../test-support/safe-env');
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const explicitUrl = process.env.TEST_DATABASE_URL;
const source = new URL(explicitUrl || 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test');
if (!['127.0.0.1', 'localhost'].includes(source.hostname) || source.pathname !== '/poupeazy_report_test') throw new Error('Use apenas PostgreSQL local descartavel.');
const databaseName = `poupeazy_report_test_events_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const isolated = new URL(source); isolated.pathname = `/${databaseName}`;
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: isolated.toString(), DATABASE_SSL: 'disable', JWT_SECRET: 'financial-event-tests-only-not-production' });
const db = require('../src/db');
const { updateEmailPreferences } = require('../src/services/email-preferences.service');
const { createFinancialEventEmailWorker } = require('../src/services/financial-event-email.service');
const { deleteAccount } = require('../src/services/account-deletion.service');

describe('Eventos financeiros por email + PostgreSQL real descartavel', { skip: !explicitUrl }, () => {
  let admin, expenseCategory, incomeCategory; let created = false;
  const password = 'SyntheticFinancialPassword123!';
  const passwordHash = bcrypt.hashSync(password, 4);
  const messages = [];
  const schema = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
  const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/008_budget_email_alerts.sql'), 'utf8');
  const worker = (sendEmail = async message => { messages.push(message); }) => createFinancialEventEmailWorker({ database: db, enabled: true, sendEmail, resetUrl: 'https://poup-eazy.vercel.app/redefinir-senha' });
  async function account(verified = true) {
    const { rows: [user] } = await db.query(`INSERT INTO usuarios (email,senha_hash,email_verificacao_obrigatoria,email_verificado_em)
      VALUES ($1,$2,FALSE,CASE WHEN $3 THEN NOW() ELSE NULL END) RETURNING *`, [`events.${crypto.randomUUID()}@example.test`, passwordHash, verified]);
    await db.query("INSERT INTO profiles (id,nome) VALUES ($1,'Pessoa sintetica')", [user.id]);
    const { rows: [budget] } = await db.query('INSERT INTO orcamento (id_usuario,ano,mes,valor_planejado) VALUES ($1,2026,11,1000) RETURNING *', [user.id]);
    return { ...user, budget };
  }
  const preferences = (user, patch) => updateEmailPreferences(db, user.id, patch);
  async function transaction(user, amount = 100, { tipo = 'despesa', status = 'confirmada', origem = 'manual', goal = null, queryable = db, external = null } = {}) {
    return (await queryable.query(`INSERT INTO despesas (id_orcamento,id_categoria,id_metas,valor,data_transacao,descricao,tipo,status,origem,id_externo)
      VALUES ($1,$2,$3,$4,'2026-11-15','Registro sintetico',$5,$6,$7,$8) RETURNING *`,
    [user.budget.id, tipo === 'receita' ? incomeCategory : expenseCategory, goal, amount, tipo, status, origem, external])).rows[0];
  }
  async function goal(user, target = 100, status = 'ativa') {
    return (await db.query("INSERT INTO metas (id_usuario,nome,valor_objetivo,data_limite,status) VALUES ($1,'Meta sintetica',$2,'2027-12-31',$3) RETURNING *", [user.id, target, status])).rows[0];
  }
  const notices = user => messages.filter(message => message.to === user.email);
  const events = async user => (await db.query('SELECT tipo,estado,id_origem,lote_id FROM email_alertas_eventos WHERE id_usuario=$1 ORDER BY tipo,id_origem', [user.id])).rows;

  before(async () => {
    admin = new Pool({ connectionString: source.toString(), ssl: false });
    assert.match(databaseName, /^poupeazy_report_test_events_\d+_[0-9a-f]{8}$/);
    await admin.query(`CREATE DATABASE "${databaseName}"`); created = true;
    await db.query(schema); await db.query(migration); await db.query(migration);
    expenseCategory = (await db.query("SELECT id FROM categoria WHERE sistema=TRUE AND tipo='despesa_variavel' LIMIT 1")).rows[0].id;
    incomeCategory = (await db.query("SELECT id FROM categoria WHERE sistema=TRUE AND tipo='receita' LIMIT 1")).rows[0].id;
  });
  after(async () => {
    await db.pool.end();
    if (created) await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    if (admin) await admin.end();
  });

  test('EVENT-DB-01 sem retroativo, opt-in independente e email confirmado', async () => {
    const user = await account();
    await transaction(user, 200); await goal(user, 100, 'concluida');
    assert.equal((await events(user)).length, 0);
    await preferences(user, { alerta_despesa_ativo: true, alerta_meta_concluida_ativo: true });
    await worker().runOnce(); assert.equal((await events(user)).length, 0); assert.equal(notices(user).length, 0);
    await transaction(user, 1000, { tipo: 'receita' }); assert.equal((await events(user)).length, 0);
    const legacy = await account(false);
    await assert.rejects(preferences(legacy, { alerta_receita_ativo: true }), error => error.status === 403 && error.code === 'EMAIL_NOT_VERIFIED');
    await preferences(legacy, { alerta_receita_valor_minimo: 150 });
    await transaction(legacy, 200, { tipo: 'receita' }); await worker().runOnce(); assert.equal(notices(legacy).length, 0);
  });

  test('EVENT-DB-02 igualdade, limites separados, confirmacao pendente e agrupamento por tipo', async () => {
    const user = await account();
    await preferences(user, { alerta_despesa_ativo: true, alerta_despesa_valor_minimo: 100, alerta_receita_ativo: true, alerta_receita_valor_minimo: 200 });
    const below = await transaction(user, 99.99); await transaction(user, 199.99, { tipo: 'receita' });
    await transaction(user, 500, { status: 'cancelada' });
    const pending = await transaction(user, 250, { status: 'pendente' });
    assert.equal((await events(user)).length, 0);
    await transaction(user, 100, { origem: 'open_finance', external: 'synthetic-import-1' });
    await transaction(user, 200, { tipo: 'receita', origem: 'chatbot' });
    await db.query("UPDATE despesas SET status='confirmada' WHERE id=$1", [pending.id]);
    await db.query('UPDATE despesas SET valor=500 WHERE id=$1', [below.id]);
    assert.equal((await events(user)).length, 3, 'editar uma despesa ja confirmada nao cria outro debito');
    await worker().runOnce(); await worker().runOnce();
    assert.equal(notices(user).length, 2, 'dois debitos em um email e uma receita em outro');
    assert.equal((await events(user)).filter(event => event.estado === 'enviado').length, 3);
    await db.query("UPDATE despesas SET status='pendente' WHERE id=$1", [pending.id]);
    await db.query("UPDATE despesas SET status='confirmada' WHERE id=$1", [pending.id]);
    await worker().runOnce(); assert.equal(notices(user).length, 2);
    await db.query(migration); assert.equal((await events(user)).length, 3);
  });

  test('EVENT-DB-03 rollback financeiro tambem desfaz o evento', async () => {
    const user = await account(); await preferences(user, { alerta_despesa_ativo: true });
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await transaction(user, 100, { queryable: client });
      assert.equal((await client.query('SELECT id FROM email_alertas_eventos WHERE id_usuario=$1', [user.id])).rowCount, 1);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    await worker().runOnce(); assert.equal((await events(user)).length, 0); assert.equal(notices(user).length, 0);
  });

  test('EVENT-DB-04 meta ao atingir valor ou concluir manualmente; sem repeticao ao reabrir', async () => {
    const user = await account(); await preferences(user, { alerta_meta_concluida_ativo: true });
    const automatic = await goal(user); await transaction(user, 100, { goal: automatic.id });
    const manual = await goal(user, 1000); await db.query("UPDATE metas SET status='concluida' WHERE id=$1", [manual.id]);
    const lowered = await goal(user, 200); await transaction(user, 100, { goal: lowered.id });
    await db.query('UPDATE metas SET valor_objetivo=50 WHERE id=$1', [lowered.id]);
    const cancelled = await goal(user, 100, 'cancelada');
    await db.query('UPDATE metas SET valor_atual=150 WHERE id=$1', [cancelled.id]);
    assert.equal((await events(user)).length, 3);
    await worker().runOnce(); assert.equal(notices(user).length, 1, 'metas do mesmo ciclo sao agrupadas');
    await transaction(user, 10, { tipo: 'receita', goal: automatic.id });
    await transaction(user, 10, { goal: automatic.id });
    await db.query("UPDATE metas SET status='ativa' WHERE id=$1", [manual.id]);
    await db.query("UPDATE metas SET status='concluida' WHERE id=$1", [manual.id]);
    await worker().runOnce(); assert.equal(notices(user).length, 1); assert.equal((await events(user)).length, 3);
  });

  test('EVENT-DB-05 cancelamento, valor alterado e opt-out antes do drain nao enviam', async () => {
    const user = await account(); await preferences(user, { alerta_despesa_ativo: true, alerta_receita_ativo: true });
    const cancelled = await transaction(user, 150); const lowered = await transaction(user, 200);
    await transaction(user, 150, { tipo: 'receita' });
    await db.query("UPDATE despesas SET status='cancelada' WHERE id=$1", [cancelled.id]);
    await db.query('UPDATE despesas SET valor=1 WHERE id=$1', [lowered.id]);
    await preferences(user, { alerta_receita_ativo: false });
    await worker().runOnce(); assert.equal(notices(user).length, 0);
    assert.ok((await events(user)).every(event => event.estado === 'cancelado'));
  });

  test('EVENT-DB-06 workers simultaneos, lotes e falha de transporte sem repeticao', async t => {
    const user = await account(); await preferences(user, { alerta_despesa_ativo: true });
    await transaction(user, 100); await transaction(user, 101);
    await Promise.all([worker().runOnce(), worker().runOnce()]);
    assert.equal(notices(user).length, 1);
    assert.equal(new Set((await events(user)).map(event => event.lote_id)).size, 1);
    const uncertain = await account(); await preferences(uncertain, { alerta_despesa_ativo: true }); await transaction(uncertain);
    const logs = []; t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
    let attempts = 0;
    await worker(async () => { attempts++; throw new Error('private-message-do-not-log'); }).runOnce();
    await worker().runOnce(); assert.equal(attempts, 1); assert.equal(notices(uncertain).length, 0);
    assert.equal((await events(uncertain))[0].estado, 'incerto');
    assert.ok(logs.every(line => !line.includes('private-message')));
  });

  async function deletionDoesNotDeadlock(sourceType) {
    const user = await account(); await preferences(user, { alerta_despesa_ativo: true, alerta_meta_concluida_ativo: true });
    const record = sourceType === 'despesa' ? await transaction(user, 150, { status: 'pendente' }) : await goal(user);
    const connectionA = await db.getClient(); const connectionB = await db.getClient();
    let deletion;
    try {
      await connectionA.query("SET statement_timeout='6s'"); await connectionB.query("SET statement_timeout='6s'");
      await connectionA.query('BEGIN');
      const table = sourceType === 'despesa' ? 'despesas' : 'metas';
      await connectionA.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [record.id]);
      const pidA = (await connectionA.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const pidB = (await connectionB.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      deletion = deleteAccount({ database: { getClient: async () => ({ query: (...args) => connectionB.query(...args), release() {} }) }, email: user.email, password });
      deletion.catch(() => {});
      let blocked = false; const deadline = Date.now() + 4000;
      while (!blocked && Date.now() < deadline) {
        blocked = (await db.query('SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked', [pidA, pidB])).rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, 'exclusao precisa estar esperando a fonte antes de executar o trigger');
      await connectionA.query(sourceType === 'despesa' ? "UPDATE despesas SET status='confirmada' WHERE id=$1" : "UPDATE metas SET status='concluida' WHERE id=$1", [record.id]);
      await connectionA.query('COMMIT'); await deletion;
      assert.equal((await events(user)).length, 0);
      assert.equal((await db.query('SELECT id FROM usuarios WHERE id=$1', [user.id])).rowCount, 0);
    } finally {
      await connectionA.query('ROLLBACK');
      if (deletion) await deletion.catch(() => {});
      await connectionA.query('RESET statement_timeout'); await connectionB.query('RESET statement_timeout');
      connectionA.release(); connectionB.release();
    }
  }
  test('EVENT-DB-07 exclusao concorrente com confirmacao de despesa nao causa deadlock', () => deletionDoesNotDeadlock('despesa'));
  test('EVENT-DB-08 exclusao concorrente com conclusao de meta nao causa deadlock', () => deletionDoesNotDeadlock('meta'));

  test('EVENT-DB-09 fontes removidas ou de outra conta nao vazam dados; fila orfa e limpa', async () => {
    const user = await account(); const other = await account();
    await preferences(user, { alerta_despesa_ativo: true, alerta_meta_concluida_ativo: true });
    const removed = await transaction(user, 200);
    await db.query('DELETE FROM despesas WHERE id=$1', [removed.id]);
    const removedGoal = await goal(user, 100, 'concluida');
    await db.query('DELETE FROM metas WHERE id=$1', [removedGoal.id]);
    const foreign = await transaction(other, 250);
    await db.query("INSERT INTO email_alertas_eventos (id_usuario,id_origem,tipo,valor_evento,valor_referencia,data_evento) VALUES ($1,$2,'despesa',250,100,CURRENT_DATE)", [user.id, foreign.id]);
    const orphan = crypto.randomUUID();
    await db.query("INSERT INTO email_alertas_eventos (id_usuario,id_origem,tipo,valor_evento,valor_referencia,data_evento) VALUES ($1,$2,'despesa',250,100,CURRENT_DATE)", [orphan, foreign.id]);
    await worker().runOnce();
    assert.equal(notices(user).length, 0); assert.equal(notices(other).length, 0);
    assert.ok((await events(user)).every(event => event.estado === 'cancelado'));
    assert.equal((await db.query('SELECT id FROM email_alertas_eventos WHERE id_usuario=$1', [orphan])).rowCount, 0);
  });

  test('EVENT-DB-10 registro cancelado pode ser confirmado uma vez, sem repetir ao reconfirmar', async () => {
    const user = await account(); await preferences(user, { alerta_receita_ativo: true });
    const record = await transaction(user, 100, { tipo: 'receita', status: 'cancelada' });
    assert.equal((await events(user)).length, 0);
    await db.query("UPDATE despesas SET status='confirmada' WHERE id=$1", [record.id]);
    await worker().runOnce(); assert.equal(notices(user).length, 1);
    await db.query("UPDATE despesas SET status='cancelada' WHERE id=$1", [record.id]);
    await db.query("UPDATE despesas SET status='confirmada' WHERE id=$1", [record.id]);
    await worker().runOnce(); assert.equal(notices(user).length, 1); assert.equal((await events(user)).length, 1);
  });
});
