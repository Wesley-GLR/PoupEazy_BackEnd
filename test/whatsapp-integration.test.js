const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const testDatabaseUrl = process.env.WHATSAPP_TEST_DATABASE_URL;

test('webhook, vínculo e extrato com PostgreSQL', { skip: !testDatabaseUrl }, async (t) => {
  const schema = `whatsapp_test_${randomBytes(8).toString('hex')}`;
  const databaseUrl = new URL(testDatabaseUrl);
  databaseUrl.searchParams.set('options', `-c search_path=${schema},public`);
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl.toString(),
    DATABASE_SSL: process.env.WHATSAPP_TEST_DATABASE_SSL || 'disable',
    JWT_SECRET: 'integration-test-for-whatsapp',
    WHATSAPP_ENABLED: 'true',
    WHATSAPP_PROVIDER: 'meta',
    WHATSAPP_API_VERSION: 'v23.0',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_BOT_NUMBER: '15551234567',
    WHATSAPP_ACCESS_TOKEN: 'test-unused',
    WHATSAPP_APP_SECRET: 'test-app-secret',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  });

  const db = require('../src/db');
  const { createApp } = require('../src/app');
  const { createWebhookRouter } = require('../src/routes/whatsapp.routes');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  await db.query(`CREATE SCHEMA ${schema}`);
  t.after(async () => {
    try {
      await db.query(`DROP SCHEMA ${schema} CASCADE`);
    } finally {
      await db.pool.end();
    }
  });
  const { rows: [current] } = await db.query('SELECT current_schema() AS schema');
  assert.equal(current.schema, schema);
  await db.query(await readFile(path.join(__dirname, '../db/schema.sql'), 'utf8'));
  await db.query(await readFile(path.join(__dirname, '../db/migrations/005_whatsapp.sql'), 'utf8'));
  await db.query(await readFile(path.join(__dirname, '../db/migrations/006_whatsapp_report.sql'), 'utf8'));

  const replies = [];
  let failNextSend = false;
  const app = createApp({ sendWhatsAppText: async (sender, text) => {
    if (failNextSend) {
      failNextSend = false;
      throw new Error('Transporte indisponível durante o teste.');
    }
    replies.push({ sender, text });
  } });
  const vonage = {
    provider: 'vonage_sandbox',
    botNumber: '447700900000',
    apiKey: 'trial-key',
    apiSecret: 'trial-api-secret',
    signatureSecret: 'trial-signature-secret',
    testRecipient: '5521999991111',
    mediaBaseUrl: 'https://reports.example.test',
  };
  const outerApp = express();
  outerApp.use('/api/vonage-test', createWebhookRouter(vonage));
  outerApp.use(app);
  const server = outerApp.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}/api`;
  function request(endpoint, { method = 'GET', body, token } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(base + endpoint, { method, headers, body: body && JSON.stringify(body) });
  }

  const owner = '5511999991111';
  const stranger = '5511999992222';
  const webhook = '/whatsapp/webhook';
  const link = '/whatsapp/vinculo';
  let sequence = 0;
  function payload(text, { sender = owner, id = `wamid.msg${++sequence}`, phoneId = '123456789',
    timestamp = Math.floor(Date.now() / 1000) } = {}) {
    return JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: phoneId },
        messages: [{ from: sender, id, type: 'text', timestamp: String(timestamp), text: { body: text } }],
      } }] }],
    });
  }

  const sign = (raw) => `sha256=${createHmac('sha256', 'test-app-secret').update(raw).digest('hex')}`;
  function send(body, signature = sign(body)) {
    return fetch(base + webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
      body,
    });
  }

  let account;
  let otherAccount;
  let linkMessage;
  async function register(name) {
    const response = await request('/auth/register', {
      method: 'POST', body: { email: `${name}@example.test`, password: 'teste-123456', nome: name },
    });
    assert.equal(response.status, 201);
    return response.json();
  }

  async function code(token) {
    const response = await request(link, { method: 'POST', token });
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { url } = await response.json();
    return new URL(url).searchParams.get('text');
  }

  async function expenses(token) {
    const response = await request('/despesas', { token });
    assert.equal(response.status, 200);
    return response.json();
  }

  await t.test('recusa webhook adulterado, destinatário diferente e vínculo sem JWT', async () => {
    const challenge = await request(`${webhook}?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=12345`);
    assert.equal(challenge.status, 200);
    assert.equal(await challenge.text(), '12345');
    assert.equal((await request(`${webhook}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=12345`)).status, 403);
    assert.equal((await request(link, { method: 'POST' })).status, 401);
    assert.equal((await request(link, { method: 'DELETE' })).status, 401);
    assert.equal((await send(payload('cabelo 35'), sign(payload('outro conteúdo')))).status, 403);
    assert.equal((await send(payload('oi', { phoneId: '111111111' }))).status, 200);
    assert.equal((await send(payload('oi', { timestamp: 0 }))).status, 200);
    assert.equal((await send('{')).status, 400);
    assert.equal(replies.length, 0);
  });

  await t.test('vincula uma vez, valida expiração e mantém as contas separadas', async () => {
    account = await register('demo');
    otherAccount = await register('outro');
    const expiredMessage = await code(account.token);
    await db.query("UPDATE whatsapp_codigos SET expira_em = NOW() - INTERVAL '1 minute'");
    assert.equal((await send(payload(expiredMessage))).status, 200);
    assert.match(replies.at(-1).text, /inválido/);

    linkMessage = await code(account.token);
    const { rows: [challenge] } = await db.query('SELECT codigo_hash FROM whatsapp_codigos');
    assert.match(challenge.codigo_hash, /^[a-f0-9]{64}$/);
    assert.ok(!challenge.codigo_hash.includes(linkMessage.split(' ')[1]));
    assert.equal((await send(payload(linkMessage))).status, 200);
    assert.match(replies.at(-1).text, /WhatsApp vinculado/);

    assert.equal((await send(payload(linkMessage, { sender: stranger }))).status, 200);
    assert.match(replies.at(-1).text, /inválido/);
    assert.equal((await request(link, { method: 'POST', token: account.token })).status, 409);
    assert.equal((await send(payload('relatório semanal', { sender: stranger }))).status, 200);
    assert.match(replies.at(-1).text, /Para vincular sua conta/);
  });

  await t.test('confirma uma vez, preserva a origem, isola o extrato e gera o resumo', async () => {
    assert.equal((await send(payload('cabelo 35 reais'))).status, 200);
    assert.match(replies.at(-1).text, /Registrar “cabelo”.*35,00.*sim ou cancelar/);
    assert.equal((await expenses(account.token)).length, 0);

    const confirm = payload('sim');
    failNextSend = true;
    assert.equal((await send(confirm)).status, 503);
    assert.equal((await expenses(account.token)).length, 1);
    const retried = await Promise.all([send(confirm), send(confirm)]);
    assert.ok(retried.every((response) => response.status === 200));
    assert.equal(replies.filter((reply) => /Gasto registrado/.test(reply.text)).length, 1);

    const rows = await expenses(account.token);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origem, 'chatbot');
    assert.equal(rows[0].descricao, 'cabelo');
    assert.equal(rows[0].valor, '35.00');
    assert.equal((await expenses(otherAccount.token)).length, 0);

    for (const [command, title] of [
      ['relatório diário', /Hoje/], ['relatório da semana', /Esta semana/],
      ['relatório do mês', /Este mês/], ['relatório total', /Todo o período/],
    ]) {
      assert.equal((await send(payload(command))).status, 200);
      assert.match(replies.at(-1).text, title);
      assert.match(replies.at(-1).text, /Gastos: R\$\s35,00/);
      assert.match(replies.at(-1).text, /Outros: R\$\s35,00/);
    }
  });

  await t.test('cancelamento, confirmação vencida e desvinculação não registram gasto', async () => {
    await send(payload('12,50 café'));
    await send(payload('cancelar'));
    assert.match(replies.at(-1).text, /cancelado/);
    await send(payload('ônibus 5'));
    await db.query("UPDATE whatsapp_vinculos SET pendencia_expira_em = NOW() - INTERVAL '1 minute'");
    await send(payload('sim'));
    assert.match(replies.at(-1).text, /Não há um gasto/);
    assert.equal((await expenses(account.token)).length, 1);

    assert.equal((await request(link, { method: 'DELETE', token: otherAccount.token })).status, 204);
    assert.equal((await request(link, { token: account.token }).then((response) => response.json())).vinculado, true);
    assert.equal((await request(link, { method: 'DELETE', token: account.token })).status, 204);
    await send(payload('relatório total'));
    assert.match(replies.at(-1).text, /Para vincular sua conta/);
  });

  await t.test('Vonage verifica o webhook, mantém vínculos por número e responde pelo Sandbox', async (t) => {
    const delivery = [];
    const originalFetch = globalThis.fetch;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      if (url !== 'https://messages-sandbox.nexmo.com/v1/messages') return originalFetch(url, options);
      assert.equal(options.headers.Authorization, `Basic ${Buffer.from('trial-key:trial-api-secret').toString('base64')}`);
      delivery.push(JSON.parse(options.body));
      return Response.json({ message_uuid: randomUUID() }, { status: 202 });
    });

    const body = (from, text, options = {}) => JSON.stringify({
      channel: 'whatsapp', message_type: 'text', from, to: vonage.botNumber,
      text, message_uuid: randomUUID(), timestamp: new Date().toISOString(), ...options,
    });
    function sendVonage(payload, {
      signedBody = payload, apiKey = vonage.apiKey, secret = vonage.signatureSecret,
    } = {}) {
      const token = jwt.sign({
        api_key: apiKey,
        payload_hash: createHash('sha256').update(signedBody).digest('hex'),
      }, secret, { algorithm: 'HS256' });
      return fetch(base + '/vonage-test', {
        method: 'POST', body: payload, headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
    }

    const first = '5521999991111';
    const second = '5521999992222';
    const firstAccount = await register('vonage-primeiro');
    const secondAccount = await register('vonage-segundo');
    const firstCode = await code(firstAccount.token);
    const secondCode = await code(secondAccount.token);
    assert.equal((await sendVonage(body(first, firstCode), { secret: 'errado' })).status, 403);
    assert.equal((await sendVonage(body(first, firstCode), { apiKey: 'outra-conta' })).status, 403);
    assert.equal((await sendVonage(body(first, firstCode), { signedBody: body(first, 'alterado') })).status, 403);
    assert.equal((await sendVonage(body(first, firstCode, { to: '447700900999' }))).status, 200);
    assert.equal(delivery.length, 0);

    assert.equal((await sendVonage(body(first, firstCode))).status, 200);
    assert.equal((await sendVonage(body(second, secondCode))).status, 200);
    assert.deepEqual(delivery.map((sent) => sent.to), ['552199991111', second]);
    assert.ok(delivery.every((sent) => sent.from === vonage.botNumber && /WhatsApp vinculado/.test(sent.text)));

    assert.equal((await sendVonage(body(first, 'cabelo 35'))).status, 200);
    assert.match(delivery.at(-1).text, /Registrar “cabelo”.*35,00/);
    assert.equal((await expenses(firstAccount.token)).length, 0);
    const confirmation = body(first, 'sim');
    assert.equal((await sendVonage(confirmation)).status, 200);
    assert.equal((await sendVonage(confirmation)).status, 200);
    assert.equal((await expenses(firstAccount.token)).length, 1);
    assert.equal((await expenses(secondAccount.token)).length, 0);

    await sendVonage(body(second, 'relatório semanal'));
    assert.match(delivery.at(-1).image.caption, /Gastos: R\$\s0,00/);
    assert.equal((await sendVonage(body(first, 'relatório semanal'))).status, 200);
    const report = delivery.at(-1);
    assert.equal(report.message_type, 'image');
    assert.match(report.image.caption, /Gastos: R\$\s35,00/);
    const image = new URL(report.image.url);
    assert.equal(image.origin, vonage.mediaBaseUrl);
    assert.match(image.pathname, /\/media\/[a-f0-9]{48}\.png$/);
    const asset = await originalFetch(base + image.pathname.replace('/api/whatsapp/webhook', '/vonage-test'));
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');
    assert.match(asset.headers.get('cache-control'), /no-store/);
    const bytes = Buffer.from(await asset.arrayBuffer());
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const bitmap = await loadImage(bytes);
    const context = createCanvas(bitmap.width, bitmap.height).getContext('2d');
    context.drawImage(bitmap, 0, 0);
    const titlePixels = context.getImageData(40, 54, 400, 43).data;
    assert.ok(
      titlePixels.some((value, index) => index % 4 === 0 && value > 220),
      'O título deve aparecer no cabeçalho escuro do relatório.'
    );
    const unknown = await originalFetch(base + '/vonage-test/media/' + '0'.repeat(48) + '.png');
    assert.equal(unknown.status, 404);
  });
});
