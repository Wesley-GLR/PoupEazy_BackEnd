require('../test-support/safe-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgres://reset_test:reset_test@127.0.0.1:1/poupeazy_report_test',
  DATABASE_SSL: 'disable', JWT_SECRET: 'password-reset-tests-only-not-production',
});
const db = require('../src/db');
const { createApp } = require('../src/app');
const { gerarToken } = require('../src/middleware/auth');
const { readPasswordResetUrl, GmailEmailError } = require('../src/config/email');

const password = 'SyntheticPassword123!';
const newPassword = 'NewSyntheticPassword123!';
const userId = 'b6fdfd35-3c12-4ff9-a61e-470f821b634b';
const oldHash = bcrypt.hashSync(password, 10);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
test.after(() => db.pool.end());

// Banco simulado para o contrato HTTP; a suite PostgreSQL cobre as operacoes SQL reais.
function accountStore() {
  const user = { id: userId, email: 'reset@example.test', senha_hash: oldHash, reset_token: null, reset_expira_em: null };
  let now = Date.now();
  const store = {
    user, advance: (milliseconds) => { now += milliseconds; },
    query: async (sql, values) => {
      if (sql.startsWith('UPDATE usuarios SET reset_token')) {
        const [hash, email] = values;
        if (email !== user.email || (user.reset_expira_em && user.reset_expira_em > now + 59 * 60000)) {
          return { rows: [], rowCount: 0 };
        }
        user.reset_token = hash;
        user.reset_expira_em = now + 3600000;
        return { rows: [{ email: user.email }], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE usuarios SET senha_hash')) {
        const [hash, tokenOrId] = values;
        const matches = sql.includes('WHERE reset_token')
          ? user.reset_token === tokenOrId && user.reset_expira_em > now : tokenOrId === user.id;
        if (!matches) return { rows: [], rowCount: 0 };
        user.senha_hash = hash;
        user.reset_token = null;
        user.reset_expira_em = null;
        return { rows: [{ id: user.id }], rowCount: 1 };
      }
      if (sql === 'SELECT id, senha_hash, email_verificado_em, email_verificacao_obrigatoria FROM usuarios WHERE id = $1') return { rows: [{ ...user }], rowCount: 1 };
      if (sql.startsWith('SELECT * FROM usuarios WHERE LOWER(email)')) return { rows: [{ ...user }], rowCount: 1 };
      if (sql.startsWith('SELECT * FROM profiles')) return { rows: [{ id: user.id, nome: 'Sintetico' }], rowCount: 1 };
      if (sql.includes('FROM metas')) return { rows: [], rowCount: 0 };
      assert.fail('Consulta inesperada no banco simulado');
    },
  };
  return store;
}

async function localApp(t, { sendEmail, store = accountStore() } = {}) {
  t.mock.method(db, 'query', store.query);
  const server = createApp({ sendEmail }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve());
  }));
  const request = async (endpoint, body, token, method = 'POST') => {
    const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${endpoint}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  return { request, store };
}

const tokenFrom = (message) => new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('RESET-01 URL confiavel usa HTTPS; HTTP somente em loopback de desenvolvimento', () => {
  assert.equal(readPasswordResetUrl({ NODE_ENV: 'production' }), 'https://poup-eazy.vercel.app/redefinir-senha');
  assert.equal(readPasswordResetUrl({ NODE_ENV: 'development', PASSWORD_RESET_URL: 'http://localhost:5173/redefinir-senha' }), 'http://localhost:5173/redefinir-senha');
  for (const value of ['http://evil.example/redefinir-senha', 'https://user:pass@example.test/reset', 'https://example.test/reset?token=old', 'https://example.test/reset#token', 'javascript:alert(1)']) {
    assert.throws(() => readPasswordResetUrl({ NODE_ENV: 'development', PASSWORD_RESET_URL: value }), { code: 'EMAIL_CONFIG_INVALID' });
  }
  assert.throws(() => readPasswordResetUrl({ NODE_ENV: 'production', PASSWORD_RESET_URL: 'http://localhost:5173/reset' }), { code: 'EMAIL_CONFIG_INVALID' });
});

test('RESET-02 desabilitado devolve 503 igual para todas as contas sem consultar o banco', async (t) => {
  const { request } = await localApp(t, { store: { query: () => assert.fail('nao deve consultar a conta') } });
  const first = await request('/auth/forgot-password', { email: 'reset@example.test' });
  const unknown = await request('/auth/forgot-password', { email: 'unknown@example.test' });
  assert.equal(first.status, 503);
  assert.deepEqual(first.body, unknown.body);
  assert.equal(first.body.code, 'EMAIL_DISABLED');
});

test('RESET-03 emissao concorrente envia uma vez, guarda so hash e permite novo pedido apos 60s', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => { messages.push(message); } });
  const results = await Promise.all([
    request('/auth/forgot-password', { email: ' RESET@EXAMPLE.TEST ' }),
    request('/auth/forgot-password', { email: store.user.email }),
    request('/auth/forgot-password', { email: 'unknown@example.test' }),
  ]);
  await settle();
  assert.equal(messages.length, 1);
  for (const result of results) {
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, results[0].body);
    assert.deepEqual(Object.keys(result.body), ['message']);
    assert.equal(result.headers.get('cache-control'), 'no-store');
  }
  const token = tokenFrom(messages[0]);
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(store.user.reset_token, digest(token));
  assert.notEqual(store.user.reset_token, token);
  assert.equal(messages[0].to, store.user.email);
  assert.match(messages[0].html, /Escolher nova senha/);
  store.advance(61000);
  await request('/auth/forgot-password', { email: store.user.email });
  await settle();
  assert.equal(messages.length, 2);
  assert.notEqual(tokenFrom(messages[1]), token);
  const superseded = await request('/auth/reset-password', { token, novaSenha: newPassword });
  assert.equal(superseded.body.code, 'RESET_TOKEN_INVALID');
});

test('RESET-04 resposta publica nao aguarda transporte e falha nao revela dados nem limpa cooldown', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  let rejectDelivery;
  let sends = 0;
  const { request, store } = await localApp(t, { sendEmail: () => {
    sends += 1;
    return new Promise((resolve, reject) => { rejectDelivery = reject; });
  } });
  const result = await request('/auth/forgot-password', { email: store.user.email });
  assert.equal(result.status, 200, 'nao aguarda a promessa de envio');
  await settle();
  rejectDelivery(new Error('secret-token reset@example.test https://private-reset-link'));
  await settle();
  const unknown = await request('/auth/forgot-password', { email: 'unknown@example.test' });
  const again = await request('/auth/forgot-password', { email: store.user.email });
  assert.deepEqual(result.body, unknown.body);
  assert.deepEqual(result.body, again.body);
  assert.equal(sends, 1);
  assert.deepEqual(logs, ['[password-reset] EMAIL_SEND_UNKNOWN']);
  assert.ok(store.user.reset_token);
});

test('RESET-05 consumo concorrente funciona uma vez e revoga senha e JWT antigos sem autologin', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  const oldToken = gerarToken(store.user);
  await request('/auth/forgot-password', { email: store.user.email });
  await settle();
  const token = tokenFrom(messages[0]);
  const results = await Promise.all([
    request('/auth/reset-password', { token, novaSenha: newPassword }),
    request('/auth/reset-password', { token, novaSenha: newPassword }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  assert.equal(results.find((result) => result.status === 400).body.code, 'RESET_TOKEN_INVALID');
  assert.deepEqual(Object.keys(results.find((result) => result.status === 200).body), ['message']);
  assert.equal(store.user.reset_token, null);
  assert.equal(await bcrypt.compare(newPassword, store.user.senha_hash), true);
  assert.equal(await bcrypt.compare(password, store.user.senha_hash), false);
  assert.equal((await request('/metas', undefined, oldToken, 'GET')).status, 401);
  assert.equal((await request('/metas', undefined, gerarToken(store.user), 'GET')).status, 200);
  assert.equal((await request('/auth/login', { email: store.user.email, password })).status, 401);
  assert.equal((await request('/auth/login', { email: store.user.email, password: newPassword })).status, 200);
});

test('RESET-06 token malformado, expirado ou legado falha; senha invalida preserva o token', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  const badToken = await request('/auth/reset-password', { token: 'invalid', novaSenha: newPassword });
  assert.equal(badToken.status, 400);
  assert.equal(badToken.body.code, 'RESET_TOKEN_INVALID');
  await request('/auth/forgot-password', { email: store.user.email });
  await settle();
  const token = tokenFrom(messages[0]);
  for (const novaSenha of ['123', 'x'.repeat(73), null]) {
    assert.equal((await request('/auth/reset-password', { token, novaSenha })).status, 422);
    assert.equal(store.user.reset_token, digest(token));
  }
  store.advance(3600001);
  assert.equal((await request('/auth/reset-password', { token, novaSenha: newPassword })).body.code, 'RESET_TOKEN_INVALID');
  store.user.reset_token = token; // Formato legado em texto puro nao e aceito.
  store.user.reset_expira_em = Date.now() + 3600000;
  assert.equal((await request('/auth/reset-password', { token, novaSenha: newPassword })).body.code, 'RESET_TOKEN_INVALID');
});

test('RESET-07 JWT legado e recusado; troca autenticada limpa reset pendente e revoga sessao', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  const oldToken = gerarToken(store.user);
  const legacyToken = jwt.sign({ sub: userId, email: store.user.email }, process.env.JWT_SECRET);
  assert.equal((await request('/metas', undefined, legacyToken, 'GET')).status, 401);
  await request('/auth/forgot-password', { email: store.user.email });
  await settle();
  const token = tokenFrom(messages[0]);
  assert.equal((await request('/auth/password', { novaSenha: newPassword }, oldToken, 'PATCH')).status, 200);
  assert.equal(store.user.reset_token, null);
  assert.equal((await request('/auth/reset-password', { token, novaSenha: password })).body.code, 'RESET_TOKEN_INVALID');
  assert.equal((await request('/metas', undefined, oldToken, 'GET')).status, 401);
});

test('RESET-08 erro de banco e codigo Gmail sao registrados sem causa/token/email', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const { request } = await localApp(t, {
    sendEmail: async () => {}, store: { query: async () => { throw new Error('private-token reset@example.test'); } },
  });
  const result = await request('/auth/forgot-password', { email: 'reset@example.test' });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'RESET_UNAVAILABLE');
  assert.deepEqual(logs, ['[password-reset] RESET_DATABASE_FAILED']);
  assert.equal(new GmailEmailError('unexpected-sensitive-value').code, 'EMAIL_SEND_UNKNOWN');
});
