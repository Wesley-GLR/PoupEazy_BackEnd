require('../test-support/safe-env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
Object.assign(process.env, {
  NODE_ENV: 'test', DATABASE_URL: 'postgres://verification_test:verification_test@127.0.0.1:1/poupeazy_report_test',
  DATABASE_SSL: 'disable', JWT_SECRET: 'email-verification-tests-only-not-production',
});
const db = require('../src/db');
const { createApp } = require('../src/app');
const { gerarToken } = require('../src/middleware/auth');
const { readEmailVerificationUrl } = require('../src/config/email');
const password = 'SyntheticPassword123!';
const passwordHash = bcrypt.hashSync(password, 10);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const settle = () => new Promise((resolve) => setImmediate(resolve));
const tokenFrom = (message) => new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token');
test.after(() => db.pool.end());

// Contrato HTTP com banco em memoria; DB-19/20 exercitam migration e SQL reais.
function memoryDatabase({ failProfile = false } = {}) {
  let users = new Map();
  let profiles = new Map();
  let snapshot;
  let now = Date.now();
  const state = {
    committed: false,
    user: (email) => users.get(email),
    advance: (milliseconds) => { now += milliseconds; },
    seed: (email, { required = false, verified = false } = {}) => {
      const user = {
        id: crypto.randomUUID(), email, senha_hash: passwordHash, criado_em: new Date(now).toISOString(),
        email_verificacao_obrigatoria: required, email_verificado_em: verified ? new Date(now).toISOString() : null,
        verificacao_token_hash: null, verificacao_expira_em: null, reset_token: null, reset_expira_em: null,
      };
      users.set(email, user); profiles.set(user.id, { id: user.id, nome: 'Sintetico', telefone: null });
      return user;
    },
    query: async (sql, values = []) => {
      const found = (row) => ({ rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 });
      if (sql === 'BEGIN') {
        snapshot = structuredClone({ users, profiles });
        state.committed = false;
        return found(null);
      }
      if (sql === 'ROLLBACK') {
        users = snapshot.users; profiles = snapshot.profiles;
        return found(null);
      }
      if (sql === 'COMMIT') { state.committed = true; return found(null); }
      if (sql.startsWith('SELECT 1 FROM usuarios WHERE LOWER(email)')) return found(users.get(values[0]));
      if (sql.startsWith('INSERT INTO usuarios')) {
        const [email, hash, verificationHash] = values;
        const user = state.seed(email, { required: true });
        user.senha_hash = hash; user.verificacao_token_hash = verificationHash; user.verificacao_expira_em = now + 86400000;
        return found(user);
      }
      if (sql.startsWith('INSERT INTO profiles')) {
        if (failProfile) throw new Error('private-token private@example.test');
        const [id, nome, telefone] = values;
        const profile = { id, nome, telefone }; profiles.set(id, profile); return found(profile);
      }
      if (sql.startsWith('UPDATE usuarios SET verificacao_token_hash')) {
        const [hash, email] = values;
        const user = users.get(email);
        if (!user || user.email_verificado_em
            || (user.verificacao_expira_em && user.verificacao_expira_em > now + 86340000)) return found(null);
        user.verificacao_token_hash = hash; user.verificacao_expira_em = now + 86400000;
        return found(user);
      }
      if (sql.startsWith('UPDATE usuarios SET email_verificado_em')) {
        const user = [...users.values()].find((entry) => entry.verificacao_token_hash === values[0]
          && entry.verificacao_expira_em > now && !entry.email_verificado_em);
        if (!user) return found(null);
        user.email_verificado_em = new Date(now).toISOString(); user.verificacao_token_hash = null; user.verificacao_expira_em = null;
        return found(user);
      }
      if (sql.startsWith('UPDATE usuarios SET reset_token')) {
        const [hash, email] = values;
        const user = users.get(email);
        if (!user || (user.reset_expira_em && user.reset_expira_em > now + 3540000)) return found(null);
        user.reset_token = hash; user.reset_expira_em = now + 3600000;
        return found(user);
      }
      if (sql.startsWith('UPDATE usuarios SET senha_hash')) {
        const user = [...users.values()].find((entry) => entry.reset_token === values[1] && entry.reset_expira_em > now);
        if (!user) return found(null);
        user.senha_hash = values[0]; user.reset_token = null; user.reset_expira_em = null;
        return found(user);
      }
      if (sql.startsWith('SELECT * FROM usuarios WHERE LOWER(email)')) return found(users.get(values[0]));
      if (sql.includes('FROM usuarios WHERE id = $1')) return found([...users.values()].find((entry) => entry.id === values[0]));
      if (sql.startsWith('SELECT * FROM profiles')) return found(profiles.get(values[0]));
      if (sql.includes('FROM metas')) return { rows: [], rowCount: 0 };
      assert.fail('Consulta inesperada no banco simulado');
    },
  };
  state.getClient = async () => ({ query: state.query, release: () => {} });
  return state;
}

async function localApp(t, { sendEmail, store = memoryDatabase() } = {}) {
  t.mock.method(db, 'query', store.query);
  t.mock.method(db, 'getClient', store.getClient || (() => assert.fail('nao deve abrir transacao')));
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

test('VERIFY-01 URL de confirmacao valida HTTPS e loopback somente em desenvolvimento', () => {
  assert.equal(readEmailVerificationUrl({ NODE_ENV: 'production' }), 'https://poup-eazy.vercel.app/confirmar-email');
  assert.equal(readEmailVerificationUrl({ NODE_ENV: 'development', EMAIL_VERIFICATION_URL: 'http://localhost:5173/confirmar-email' }), 'http://localhost:5173/confirmar-email');
  for (const value of ['http://evil.example/confirm', 'https://user:secret@example.test/confirm', 'https://example.test/confirm?token=old', 'https://example.test/confirm#old', 'javascript:alert(1)']) {
    assert.throws(() => readEmailVerificationUrl({ NODE_ENV: 'development', EMAIL_VERIFICATION_URL: value }), { code: 'EMAIL_CONFIG_INVALID' });
  }
  assert.throws(() => readEmailVerificationUrl({ NODE_ENV: 'production', EMAIL_VERIFICATION_URL: 'http://localhost:5173/confirmar-email' }), { code: 'EMAIL_CONFIG_INVALID' });
});

test('VERIFY-02 envio desativado impede criar conta bloqueada ou consultar reenvio', async (t) => {
  const store = { query: () => assert.fail('nao deve consultar conta'), getClient: () => assert.fail('nao deve criar conta') };
  const { request } = await localApp(t, { store });
  const register = await request('/auth/register', { email: 'new@example.test', password });
  assert.equal(register.status, 503);
  assert.equal(register.body.code, 'EMAIL_DISABLED');
  const resend = await request('/auth/resend-verification', { email: 'new@example.test' });
  const unknown = await request('/auth/resend-verification', { email: 'unknown@example.test' });
  assert.equal(resend.status, 503);
  assert.deepEqual(resend.body, unknown.body);
});

test('VERIFY-03 cadastro confirma transacao antes do email, guarda hash e nao cria sessao', async (t) => {
  const store = memoryDatabase();
  const messages = [];
  const { request } = await localApp(t, { store, sendEmail: async (message) => {
    assert.equal(store.committed, true); messages.push(message);
  } });
  const result = await request('/auth/register', { email: ' NEW@EXAMPLE.TEST ', password, nome: 'Pessoa teste' });
  await settle();
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body).sort(), ['emailVerificationRequired', 'message']);
  assert.equal(result.body.emailVerificationRequired, true);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(messages.length, 1);
  const token = tokenFrom(messages[0]);
  const user = store.user('new@example.test');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(user.verificacao_token_hash, digest(token));
  assert.notEqual(user.verificacao_token_hash, token);
  assert.equal(user.email_verificacao_obrigatoria, true);
  assert.equal(user.email_verificado_em, null);
  assert.equal(await bcrypt.compare(password, user.senha_hash), true);
  assert.equal((await request('/auth/register', { email: user.email, password })).status, 409);
  await settle();
  assert.equal(messages.length, 1);
});

test('VERIFY-04 senha incorreta permanece 401; login e JWT de conta pendente recebem 403', async (t) => {
  const store = memoryDatabase();
  const pending = store.seed('pending@example.test', { required: true });
  const { request } = await localApp(t, { store, sendEmail: async () => {} });
  assert.equal((await request('/auth/login', { email: pending.email, password: 'incorrect-password' })).status, 401);
  const denied = await request('/auth/login', { email: pending.email, password });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'EMAIL_NOT_VERIFIED');
  assert.equal('token' in denied.body, false);
  const jwt = gerarToken(pending);
  const protectedResult = await request('/metas', undefined, jwt, 'GET');
  assert.equal(protectedResult.status, 403);
  assert.equal(protectedResult.body.code, 'EMAIL_NOT_VERIFIED');
});

test('VERIFY-05 apenas POST confirma; concorrencia consome uma vez e permite login com DTO seguro', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  await request('/auth/register', { email: 'new@example.test', password });
  await settle();
  const token = tokenFrom(messages[0]);
  assert.equal((await request(`/auth/confirm-email?token=${token}`, undefined, undefined, 'GET')).status, 404);
  assert.equal(store.user('new@example.test').email_verificado_em, null);
  const malformed = await request('/auth/confirm-email', { token: 'bad-token' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'EMAIL_VERIFICATION_TOKEN_INVALID');
  const results = await Promise.all([
    request('/auth/confirm-email', { token }), request('/auth/confirm-email', { token }),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 400]);
  assert.deepEqual(Object.keys(results.find((result) => result.status === 200).body), ['message']);
  assert.equal(results.find((result) => result.status === 400).body.code, 'EMAIL_VERIFICATION_TOKEN_INVALID');
  const user = store.user('new@example.test');
  assert.equal(user.verificacao_token_hash, null);
  assert.equal(user.verificacao_expira_em, null);
  const login = await request('/auth/login', { email: user.email, password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email_verificado, true);
  assert.equal(login.body.user.email_verificacao_obrigatoria, true);
  assert.equal('verificacao_token_hash' in login.body.user, false);
  const me = await request('/auth/me', undefined, login.body.token, 'GET');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email_verificado, true);
});

test('VERIFY-06 reenvio e generico e cooldown de 60s impede emails concorrentes', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  await request('/auth/register', { email: 'pending@example.test', password });
  await settle();
  const oldToken = tokenFrom(messages[0]);
  store.seed('verified@example.test', { required: true, verified: true });
  const results = [];
  for (const email of ['pending@example.test', 'verified@example.test', 'unknown@example.test']) {
    results.push(await request('/auth/resend-verification', { email }));
  }
  await settle();
  assert.equal(messages.length, 1);
  for (const result of results) { assert.equal(result.status, 200); assert.deepEqual(result.body, results[0].body); }
  store.advance(61000);
  await Promise.all([
    request('/auth/resend-verification', { email: 'pending@example.test' }),
    request('/auth/resend-verification', { email: 'pending@example.test' }),
  ]);
  await settle();
  assert.equal(messages.length, 2);
  assert.notEqual(tokenFrom(messages[1]), oldToken);
  assert.equal((await request('/auth/confirm-email', { token: oldToken })).body.code, 'EMAIL_VERIFICATION_TOKEN_INVALID');
});

test('VERIFY-07 contas antigas mantem login e podem confirmar opcionalmente sem mudar obrigatoriedade', async (t) => {
  const store = memoryDatabase(); store.seed('legacy@example.test');
  const messages = [];
  const { request } = await localApp(t, { store, sendEmail: async (message) => messages.push(message) });
  const login = await request('/auth/login', { email: 'legacy@example.test', password });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.email_verificado, false);
  assert.equal(login.body.user.email_verificacao_obrigatoria, false);
  assert.equal((await request('/metas', undefined, login.body.token, 'GET')).status, 200);
  assert.equal((await request('/auth/resend-verification', { email: 'legacy@example.test' })).status, 200);
  await settle();
  assert.equal(messages.length, 1);
  assert.equal((await request('/auth/confirm-email', { token: tokenFrom(messages[0]) })).status, 200);
  const updated = await request('/auth/me', undefined, login.body.token, 'GET');
  assert.equal(updated.body.user.email_verificado, true);
  assert.equal(updated.body.user.email_verificacao_obrigatoria, false);
});

test('VERIFY-08 tokens de reset e confirmacao nao se substituem e reset nao libera conta pendente', async (t) => {
  const messages = [];
  const { request, store } = await localApp(t, { sendEmail: async (message) => messages.push(message) });
  const email = 'pending@example.test';
  await request('/auth/register', { email, password }); await settle();
  const verificationToken = tokenFrom(messages[0]);
  await request('/auth/forgot-password', { email }); await settle();
  const resetToken = tokenFrom(messages[1]);
  assert.equal((await request('/auth/confirm-email', { token: resetToken })).body.code, 'EMAIL_VERIFICATION_TOKEN_INVALID');
  assert.equal((await request('/auth/reset-password', { token: verificationToken, novaSenha: 'NewSyntheticPassword123!' })).body.code, 'RESET_TOKEN_INVALID');
  assert.equal((await request('/auth/reset-password', { token: resetToken, novaSenha: 'NewSyntheticPassword123!' })).status, 200);
  assert.equal((await request('/auth/login', { email, password: 'NewSyntheticPassword123!' })).body.code, 'EMAIL_NOT_VERIFIED');
  assert.equal(store.user(email).verificacao_token_hash, digest(verificationToken));
  assert.equal((await request('/auth/confirm-email', { token: verificationToken })).status, 200);
  assert.equal((await request('/auth/login', { email, password: 'NewSyntheticPassword123!' })).status, 200);
});

test('VERIFY-09 link expira em 24h; falha de cadastro desfaz dados e nao envia email', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const messages = [];
  const store = memoryDatabase({ failProfile: true });
  const { request } = await localApp(t, { store, sendEmail: async (message) => messages.push(message) });
  const failed = await request('/auth/register', { email: 'new@example.test', password });
  await settle();
  assert.equal(failed.status, 503);
  assert.equal(failed.body.code, 'REGISTRATION_UNAVAILABLE');
  assert.equal(store.user('new@example.test'), undefined);
  assert.equal(messages.length, 0);
  assert.deepEqual(logs, ['[email-verification] REGISTRATION_DATABASE_FAILED']);
  const pending = store.seed('pending@example.test', { required: true });
  await request('/auth/resend-verification', { email: pending.email }); await settle();
  const token = tokenFrom(messages[0]);
  store.advance(86400001);
  assert.equal((await request('/auth/confirm-email', { token })).body.code, 'EMAIL_VERIFICATION_TOKEN_INVALID');
});

test('VERIFY-10 falha no transporte preserva cadastro e cooldown sem expor erro bruto', async (t) => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  let attempts = 0;
  const { request, store } = await localApp(t, { sendEmail: async () => {
    attempts += 1; throw new Error('private-token new@example.test https://private-link');
  } });
  assert.equal((await request('/auth/register', { email: 'new@example.test', password })).status, 201);
  await settle();
  const resend = await request('/auth/resend-verification', { email: 'new@example.test' });
  const unknown = await request('/auth/resend-verification', { email: 'unknown@example.test' });
  await settle();
  assert.deepEqual(resend.body, unknown.body);
  assert.equal(attempts, 1);
  assert.ok(store.user('new@example.test').verificacao_token_hash);
  assert.equal(store.user('new@example.test').email_verificado_em, null);
  assert.deepEqual(logs, ['[email-verification] EMAIL_SEND_UNKNOWN']);
});
