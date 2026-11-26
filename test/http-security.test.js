const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

// These values are deliberately set before importing the app. No production
// connection or Pluggy credential from a developer environment can be used.
Object.assign(process.env, {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgres://report_test:report_test@127.0.0.1:1/poupeazy_report_test',
  DATABASE_SSL: 'disable',
  JWT_SECRET: 'report-http-tests-only-not-a-production-secret',
  PLUGGY_CLIENT_ID: '',
  PLUGGY_CLIENT_SECRET: '',
  CORS_ORIGIN: 'https://report.example',
  JSON_BODY_LIMIT: '1kb',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_MAX: '100',
  AUTH_RATE_LIMIT_MAX: '100',
  TRUST_PROXY: 'false',
});

const { createApp } = require('../src/app');
const config = require('../src/config');
const db = require('../src/db');

test.after(() => db.pool.end());

async function localApp(t, limits = {}) {
  config.rateLimit.max = limits.max || 100;
  config.rateLimit.authMax = limits.authMax || 100;
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (path, options) => fetch(`${base}${path}`, options);
}

test('HTTP-01 healthcheck publico retorna apenas status sem infraestrutura', async (t) => {
  const request = await localApp(t);
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('HTTP-02 rota inexistente retorna 404 JSON padronizado', async (t) => {
  const request = await localApp(t);
  const response = await request('/api/rota-inexistente');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Rota nao encontrada: GET /api/rota-inexistente' });
});

test('HTTP-03 JSON malformado retorna 400 antes da autenticacao/banco', async (t) => {
  const request = await localApp(t);
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email":',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'JSON malformado.' });
});

test('HTTP-04 corpo acima do limite configurado retorna 413', async (t) => {
  const request = await localApp(t);
  const response = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(2048) }),
  });
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /excede o limite/);
});

test('HTTP-05 Helmet remove identificacao Express e aplica headers de seguranca', async (t) => {
  const request = await localApp(t);
  const response = await request('/api/health');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
});

test('HTTP-06 CORS anuncia somente a origem permitida configurada', async (t) => {
  const request = await localApp(t);
  const allowed = await request('/api/health', { headers: { Origin: 'https://report.example' } });
  const other = await request('/api/health', { headers: { Origin: 'https://other.example' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://report.example');
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

for (const [id, name, authorization] of [
  ['07', 'token ausente', undefined],
  ['08', 'token invalido', 'Bearer not-a-jwt'],
  ['09', 'assinatura de outro emissor', `Bearer ${jwt.sign({ sub: 'b6fdfd35-3c12-4ff9-a61e-470f821b634b' }, 'another-test-secret')}`],
  ['10', 'token expirado', `Bearer ${jwt.sign({ sub: 'b6fdfd35-3c12-4ff9-a61e-470f821b634b' }, config.jwtSecret, { expiresIn: -1 })}`],
]) {
  test(`HTTP-${id} recurso protegido recusa ${name} com 401`, async (t) => {
    const request = await localApp(t);
    const response = await request('/api/metas', { headers: authorization ? { Authorization: authorization } : {} });
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.match(body.error, /Token/);
    assert.deepEqual(Object.keys(body), ['error']);
  });
}

test('HTTP-11 limite global ativo bloqueia a terceira requisicao e envia Retry-After', async (t) => {
  assert.equal(config.isTest, false, 'rate limiting must be enabled in this suite');
  const request = await localApp(t, { max: 2 });
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/health')).status, 200);
  const blocked = await request('/api/health');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  assert.match((await blocked.json()).error, /Muitas requisicoes/);
});

test('HTTP-12 limite de autenticacao ativo bloqueia tentativas sem bloquear health', async (t) => {
  const request = await localApp(t, { max: 100, authMax: 2 });
  const login = () => request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal((await login()).status, 400);
  assert.equal((await login()).status, 400);
  const blocked = await login();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /Muitas tentativas de autenticacao/);
  assert.equal((await request('/api/health')).status, 200);
});
