const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('node:util');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readEmailConfig } = require('../src/config/email');
const { createGmailService, GmailEmailError } = require('../src/services/gmail.service');
const { OAuth2Client } = require('google-auth-library');

// Exclusivamente credenciais sinteticas; nenhum teste acessa o Google ou envia e-mail.
const syntheticEnv = {
  EMAIL_ENABLED: 'true', EMAIL_FROM: 'poupeazy@gmail.com',
  GMAIL_CLIENT_ID: 'synthetic-client.apps.googleusercontent.com',
  GMAIL_CLIENT_SECRET: 'synthetic-client-secret', GMAIL_REFRESH_TOKEN: 'synthetic-refresh-token',
};
const settings = readEmailConfig(syntheticEnv);
const message = { to: 'receiver@example.test', subject: 'Teste PoupEazy', text: 'Mensagem sintetica.' };

function successfulAuth() {
  return { getAccessToken: async () => ({ token: 'synthetic-access-token' }), setCredentials: () => {} };
}

test('GMAIL-01 configuracao opcional e validacao de credenciais sem expor valores', () => {
  assert.deepEqual(readEmailConfig({}), { enabled: false });
  assert.equal(settings.testRecipient, 'poupeazy@gmail.com');
  for (const overrides of [
    { EMAIL_ENABLED: 'yes' }, { GMAIL_CLIENT_SECRET: '' }, { GMAIL_REFRESH_TOKEN: '' },
    { EMAIL_FROM: 'another@gmail.com' }, { GMAIL_CLIENT_ID: 'not-a-client' },
    { GMAIL_TEST_RECIPIENT: 'a@example.test,b@example.test' },
    { GMAIL_REFRESH_TOKEN: 'bad\r\ntoken' },
  ]) {
    assert.throws(() => readEmailConfig({ ...syntheticEnv, ...overrides }), (error) => {
      assert.ok(error instanceof GmailEmailError);
      assert.equal(error.code, 'EMAIL_CONFIG_INVALID');
      assert.equal(inspect(error).includes(syntheticEnv.GMAIL_CLIENT_SECRET), false);
      assert.equal(inspect(error).includes(syntheticEnv.GMAIL_REFRESH_TOKEN), false);
      return true;
    });
  }
});

test('GMAIL-02 envio desativado nunca consulta OAuth ou rede', async () => {
  const service = createGmailService(readEmailConfig({}), {
    authClient: { getAccessToken: () => assert.fail('OAuth nao deveria ser chamado') },
    fetchImpl: () => assert.fail('rede nao deveria ser chamada'),
  });
  await assert.rejects(service.send(message), { code: 'EMAIL_DISABLED' });
});

test('GMAIL-03 compoe MIME UTF-8 e envia somente ao destinatario e caixa configurados', async () => {
  let requests = 0;
  const service = createGmailService(settings, {
    authClient: successfulAuth(),
    fetchImpl: async (url, options) => {
      requests += 1;
      assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/poupeazy%40gmail.com/messages/send');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access-token');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body), ['raw']);
      assert.match(body.raw, /^[A-Za-z0-9_-]+$/);
      const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
      assert.match(mime, /^From: PoupEazy <poupeazy@gmail.com>\r?$/m);
      assert.match(mime, /^To: receiver@example.test\r?$/m);
      assert.match(mime, /multipart\/alternative/);
      assert.match(mime, /charset=utf-8/i);
      assert.doesNotMatch(mime, /synthetic-client-secret|synthetic-refresh-token|synthetic-access-token/);
      // Campos de entrega e MIME bruto nao passam pelo contrato deste servico.
      assert.doesNotMatch(mime, /^Bcc:|^Cc:|unexpected-recipient|unexpected-body|secret-file/m);
      return Response.json({ id: 'synthetic-message-id', threadId: 'synthetic-thread-id', privateField: 'omit' });
    },
  });
  const result = await service.send({
    ...message, html: '<p>Olá! Conteúdo de teste.</p>',
    from: 'unexpected-recipient@example.test', cc: 'unexpected-recipient@example.test',
    bcc: 'unexpected-recipient@example.test', raw: 'unexpected-body',
  });
  assert.equal(requests, 1);
  assert.deepEqual(result, { id: 'synthetic-message-id', threadId: 'synthetic-thread-id' });
});

test('GMAIL-04 rejeita injecao de headers, multiplos destinatarios e corpo excessivo antes da rede', async () => {
  const service = createGmailService(settings, {
    authClient: { getAccessToken: () => assert.fail('OAuth nao deveria ser chamado') },
    fetchImpl: () => assert.fail('rede nao deveria ser chamada'),
  });
  for (const overrides of [
    { to: 'a@example.test,b@example.test' }, { to: 'a@example.test\r\nBcc: b@example.test' },
    { to: 'Pessoa <a@example.test>' }, { subject: 'Titulo\r\nBcc: b@example.test' },
    { text: '' }, { text: 'x'.repeat(512 * 1024 + 1) }, { html: { path: '/private-file' } },
  ]) {
    await assert.rejects(service.send({ ...message, ...overrides }), { code: 'EMAIL_MESSAGE_INVALID' });
  }
});

test('GMAIL-05 falhas OAuth sao sanitizadas antes de chegar ao chamador', async () => {
  const authError = Object.assign(new Error(`invalid_grant ${syntheticEnv.GMAIL_REFRESH_TOKEN}`), {
    config: { data: syntheticEnv }, response: { status: 400, data: syntheticEnv },
  });
  const service = createGmailService(settings, {
    authClient: { getAccessToken: async () => { throw authError; } },
    fetchImpl: () => assert.fail('nao pode enviar sem autorizacao'),
  });
  await assert.rejects(service.send(message), (error) => {
    assert.equal(error.code, 'EMAIL_AUTH_FAILED');
    assert.equal(error.cause, undefined);
    assert.doesNotMatch(inspect(error), /synthetic-refresh-token|synthetic-client-secret|invalid_grant/);
    return true;
  });
});

test('GMAIL-06 indisponibilidade de OAuth nao inicia o envio', async () => {
  const service = createGmailService(settings, {
    authClient: { getAccessToken: async () => { throw new Error('synthetic timeout'); } },
    fetchImpl: () => assert.fail('nao pode enviar sem autorizacao'),
  });
  await assert.rejects(service.send(message), { code: 'EMAIL_AUTH_TEMPORARY' });
});

test('GMAIL-07 distingue permissao, quota e rejeicao sem repetir o POST ou vazar resposta', async () => {
  for (const [status, reason, code] of [
    [403, 'forbidden', 'EMAIL_PERMISSION_DENIED'], [403, 'userRateLimitExceeded', 'EMAIL_RATE_LIMITED'],
    [429, '', 'EMAIL_RATE_LIMITED'], [400, '', 'EMAIL_SEND_REJECTED'],
    [503, '', 'EMAIL_SEND_UNKNOWN'],
  ]) {
    let requests = 0;
    const service = createGmailService(settings, {
      authClient: successfulAuth(), fetchImpl: async () => {
        requests += 1;
        return Response.json({ error: { message: 'synthetic-refresh-token', errors: [{ reason }] } }, { status });
      },
    });
    await assert.rejects(service.send(message), (error) => {
      assert.equal(error.code, code);
      assert.doesNotMatch(inspect(error), /synthetic-refresh-token/);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('GMAIL-08 resposta 401 limpa o access token e nao reenvia a mensagem', async () => {
  let requests = 0;
  let nextCredentials;
  const service = createGmailService(settings, {
    authClient: { ...successfulAuth(), setCredentials: (credentials) => { nextCredentials = credentials; } },
    fetchImpl: async () => { requests += 1; return Response.json({ error: {} }, { status: 401 }); },
  });
  await assert.rejects(service.send(message), { code: 'EMAIL_AUTH_FAILED' });
  assert.equal(requests, 1);
  assert.deepEqual(nextCredentials, { refresh_token: syntheticEnv.GMAIL_REFRESH_TOKEN });
});

test('GMAIL-09 timeout ou resposta perdida deixa resultado incerto sem reenvio', async () => {
  for (const fetchImpl of [
    async () => { throw new DOMException('synthetic-access-token', 'TimeoutError'); },
    async () => new Response('synthetic-access-token', { status: 502 }),
    async () => Response.json({ unexpected: 'synthetic-access-token' }),
  ]) {
    let requests = 0;
    const service = createGmailService(settings, {
      authClient: successfulAuth(), fetchImpl: (...args) => { requests += 1; return fetchImpl(...args); },
    });
    await assert.rejects(service.send(message), (error) => {
      assert.equal(error.code, 'EMAIL_SEND_UNKNOWN');
      assert.doesNotMatch(inspect(error), /synthetic-access-token/);
      return true;
    });
    assert.equal(requests, 1);
  }
});

test('GMAIL-10 CLI recusa argumentos e funciona sem banco, sem mostrar segredos', () => {
  const script = path.resolve(__dirname, '..', 'scripts', 'send-test-email.js');
  const env = { ...process.env, ...syntheticEnv, EMAIL_ENABLED: 'false', DATABASE_URL: '', JWT_SECRET: '' };
  for (const [args, expected] of [[[], /EMAIL_DISABLED/], [['unexpected'], /nao aceita argumentos/]]) {
    const preload = path.resolve(__dirname, '..', 'test-support', 'safe-env.js');
    const result = spawnSync(process.execPath, ['--require', preload, script, ...args], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, expected);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-client-secret|synthetic-refresh-token|DATABASE_URL|JWT_SECRET/);
  }
});

test('GMAIL-11 cliente OAuth real limita timeout/retry e desativa interceptors de logs sensiveis', async (t) => {
  t.mock.method(OAuth2Client.prototype, 'getAccessToken', async function () {
    assert.equal(this.transporter.defaults.timeout, 15000);
    assert.equal(this.transporter.defaults.retryConfig.retry, 0);
    assert.equal(this.transporter.defaults.maxRedirects, 0);
    assert.equal(this.transporter.interceptors.request.size, 0);
    assert.equal(this.transporter.interceptors.response.size, 0);
    assert.equal(this.credentials.refresh_token, syntheticEnv.GMAIL_REFRESH_TOKEN);
    return { token: 'synthetic-access-token' };
  });
  const service = createGmailService(settings, { fetchImpl: async () => Response.json({ id: 'synthetic-id' }) });
  assert.deepEqual(await service.send(message), { id: 'synthetic-id' });
});

test('GMAIL-12 anexos so aceitam Buffers PDF/CSV com nome, MIME e tamanho seguros',async()=>{
  const service=createGmailService(settings,{authClient:{getAccessToken:()=>assert.fail('nao deve consultar OAuth')},fetchImpl:()=>assert.fail('nao deve acessar rede')});
  const file={filename:'poupeazy-resumo-2026-11-01-2026-11-27.csv',content:Buffer.from('\uFEFFa;b\r\n'),contentType:'text/csv; charset=utf-8'};
  for(const patch of [{path:'/private'},{href:'https://private'},{raw:'private'},{cid:'x'},{encoding:'base64'},{headers:{}},
    {content:'string'},{content:{type:'Buffer',data:[1]}},{filename:'../private.csv'},{filename:'evil\r\nBcc: private.csv'},
    {contentType:'application/pdf'},{content:Buffer.from('without-bom')},
  ])await assert.rejects(service.send({...message,attachments:[{...file,...patch}]}),{code:'EMAIL_MESSAGE_INVALID'});
  await assert.rejects(service.send({...message,attachments:Array(7).fill(file)}),{code:'EMAIL_MESSAGE_INVALID'});
  await assert.rejects(service.send({...message,attachments:[{filename:'poupeazy-relatorio-2026-11-01-2026-11-27.pdf',content:Buffer.alloc(5*1024*1024+1,'%PDF-'),contentType:'application/pdf'}]}),{code:'EMAIL_MESSAGE_INVALID'});
});

test('GMAIL-13 MIME inclui anexos validados sem caminhos nem destinatario adicional',async()=>{
  let calls=0;
  const service=createGmailService(settings,{authClient:successfulAuth(),fetchImpl:async(url,options)=>{
    calls++;const raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString('utf8');
    assert.match(raw,/Content-Type: application\/pdf/);
    assert.match(raw,/Content-Type: text\/csv/);
    assert.match(raw,/Content-Disposition: attachment/);
    assert.doesNotMatch(raw,/Bcc:/);
    return Response.json({id:'synthetic-id'});
  }});
  await service.send({...message,attachments:[
    {filename:'poupeazy-relatorio-2026-11-01-2026-11-27.pdf',content:Buffer.from('%PDF-1.7\nsynthetic'),contentType:'application/pdf'},
    {filename:'poupeazy-resumo-2026-11-01-2026-11-27.csv',content:Buffer.from('\uFEFFa;b\r\n'),contentType:'text/csv; charset=utf-8'},
  ]});
  assert.equal(calls,1);
});
