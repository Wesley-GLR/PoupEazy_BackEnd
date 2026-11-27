const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');

// Nenhum teste deste arquivo acessa um banco ou provedor real.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://account_test:account_test@127.0.0.1:1/poupeazy_report_test',
  DATABASE_SSL: 'disable',
  JWT_SECRET: 'account-deletion-tests-only-not-production',
  PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '', WHATSAPP_ENABLED: 'false',
});

const db = require('../src/db');
const { createApp } = require('../src/app');
const { gerarToken } = require('../src/middleware/auth');
const { deleteAccount } = require('../src/services/account-deletion.service');
const user = {
  id: 'b6fdfd35-3c12-4ff9-a61e-470f821b634b',
  email: 'delete@example.test',
  senha_hash: bcrypt.hashSync('SyntheticPassword123!', 10),
};
test.after(() => db.pool.end());

async function localApp(t) {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  return (path, options) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, options);
}

function fakeDatabase({ account = user, failDelete = false, whatsapp = true } = {}) {
  const statements = [];
  let released = false;
  const client = {
    query: async (sql, values) => {
      statements.push(sql.trim());
      if (sql.startsWith('SELECT id, senha_hash')) {
        assert.deepEqual(values, [user.email]);
        return { rows: account ? [account] : [], rowCount: account ? 1 : 0 };
      }
      if (sql.includes('to_regclass')) {
        return { rows: [{ vinculos: whatsapp ? 'whatsapp_vinculos' : null,
          codigos: whatsapp ? 'whatsapp_codigos' : null,
          mensagens: whatsapp ? 'whatsapp_mensagens' : null }], rowCount: 1 };
      }
      if (failDelete && sql.startsWith('DELETE FROM usuarios')) {
        throw new Error('synthetic-database-failure');
      }
      if (values) assert.deepEqual(values, [user.id]);
      return { rows: [], rowCount: 1 };
    },
    release: () => { released = true; },
  };
  return { getClient: async () => client, statements, wasReleased: () => released };
}

test('ACCOUNT-01 conta inexistente e senha incorreta nao apagam dados e recebem o mesmo erro', async () => {
  for (const account of [null, user]) {
    const database = fakeDatabase({ account });
    await assert.rejects(
      deleteAccount({ database, email: user.email, password: 'WrongSyntheticPassword!' }),
      (error) => error.status === 401 && error.message === 'E-mail ou senha invalidos.'
    );
    assert.equal(database.statements.some((sql) => sql.startsWith('DELETE')), false);
    assert.ok(database.statements.includes('ROLLBACK'));
    assert.equal(database.wasReleased(), true);
  }
});

test('ACCOUNT-02 falha durante exclusao desfaz a transacao e libera a conexao', async () => {
  const database = fakeDatabase({ failDelete: true });
  await assert.rejects(
    deleteAccount({ database, email: user.email, password: 'SyntheticPassword123!' }),
    /synthetic-database-failure/
  );
  assert.ok(database.statements.some((sql) => sql.startsWith('DELETE FROM despesas')));
  assert.ok(database.statements.includes('ROLLBACK'));
  assert.equal(database.statements.includes('COMMIT'), false);
  assert.equal(database.wasReleased(), true);
});

test('ACCOUNT-03 endpoint publico exige confirmacao explicita antes de acessar dados', async (t) => {
  t.mock.method(db, 'getClient', () => assert.fail('nao deve acessar banco'));
  const request = await localApp(t);
  const response = await request('/auth/delete-account', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'SyntheticPassword123!' }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /EXCLUIR/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('ACCOUNT-04 endpoint publico reautentica, normaliza email e so confirma apos COMMIT', async (t) => {
  const database = fakeDatabase();
  t.mock.method(db, 'getClient', database.getClient);
  const request = await localApp(t);
  const response = await request('/auth/delete-account', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '  DELETE@EXAMPLE.TEST ', password: 'SyntheticPassword123!', confirmacao: 'EXCLUIR' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { message: 'Conta e dados associados excluidos da base ativa do PoupEazy.' });
  assert.ok(database.statements.includes('COMMIT'));
  assert.equal(database.wasReleased(), true);
});

test('ACCOUNT-05 JWT de uma conta excluida nao chega ao recurso protegido', async (t) => {
  t.mock.method(db, 'query', async (sql, values) => {
    assert.equal(sql, 'SELECT id, senha_hash FROM usuarios WHERE id = $1');
    assert.deepEqual(values, [user.id]);
    return { rows: [], rowCount: 0 };
  });
  const request = await localApp(t);
  const response = await request('/metas', { headers: { Authorization: `Bearer ${gerarToken(user)}` } });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Token invalido ou expirado.' });
});

test('ACCOUNT-06 banco sem integracao WhatsApp tambem permite excluir a conta', async () => {
  const database = fakeDatabase({ whatsapp: false });
  await deleteAccount({ database, email: user.email, password: 'SyntheticPassword123!' });
  assert.equal(database.statements.some((sql) => sql.startsWith('DELETE FROM whatsapp_')), false);
  assert.ok(database.statements.includes('COMMIT'));
});
