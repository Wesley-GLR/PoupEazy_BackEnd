const express = require('express');
const jwt = require('jsonwebtoken');
const { createHash, randomBytes } = require('node:crypto');
const { handleMessages } = require('../services/whatsapp.service');
const { currency } = require('../services/whatsapp-text');
const { renderReportImage } = require('../services/whatsapp-report-image');

const sandboxMessagesUrl = 'https://messages-sandbox.nexmo.com/v1/messages';
const phoneNumber = /^[1-9]\d{6,14}$/;
const messageUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function authenticate(req, config) {
  const match = /^Bearer (\S+)$/i.exec(req.get('Authorization') || '');
  if (!match) return false;

  try {
    const claims = jwt.verify(match[1], config.signatureSecret, {
      algorithms: ['HS256'], maxAge: '25h', clockTolerance: 60,
    });
    const hash = createHash('sha256').update(req.body).digest('hex');
    return claims.api_key === config.apiKey && claims.payload_hash === hash
      && claims.iat <= Date.now() / 1000 + 60;
  } catch {
    return false;
  }
}

function readMessage(payload, config, now = Date.now()) {
  if (payload?.channel !== 'whatsapp' || payload.message_type !== 'text'
      || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 4096
      || typeof payload.from !== 'string' || !phoneNumber.test(payload.from)
      || payload.to !== config.botNumber || typeof payload.message_uuid !== 'string'
      || !messageUuid.test(payload.message_uuid) || typeof payload.timestamp !== 'string') return null;

  const timestamp = Date.parse(payload.timestamp);
  const age = now - timestamp;
  if (!Number.isFinite(timestamp) || age > 24 * 60 * 60 * 1000 || age < -60_000) return null;

  // Preserva o vínculo do celular de teste cujo ID chegava da Meta sem o nono dígito.
  const { testRecipient } = config;
  const sender = testRecipient && payload.from === testRecipient
    ? testRecipient.slice(0, 4) + testRecipient.slice(5)
    : payload.from;
  return { id: `vonage:${payload.message_uuid.toLowerCase()}`, sender, text: payload.text, timestamp: Math.floor(timestamp / 1000) };
}

async function sendVonageMessage(config, sender, content) {
  const authorization = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
  const response = await fetch(sandboxMessagesUrl, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: 'whatsapp', from: config.botNumber, to: sender, ...content }),
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  if (!response.ok) {
    const error = new Error('A Vonage recusou o envio pelo WhatsApp.');
    error.code = `VONAGE_HTTP_${response.status}`;
    throw error;
  }
}

function createVonageWebhookRouter(config, sendText) {
  const router = express.Router();
  const images = new Map();

  async function deliver(sender, text, report) {
    if (report && config.mediaBaseUrl) {
      const now = Date.now();
      for (const [key, entry] of images) {
        if (entry.expiresAt <= now) images.delete(key);
      }
      if (images.size < 64) {
        const token = randomBytes(24).toString('hex');
        try {
          const png = await renderReportImage(report);
          const ttl = 10 * 60 * 1000;
          images.set(token, { png, expiresAt: now + ttl });
          setTimeout(() => images.delete(token), ttl).unref();
          const url = new URL(`/api/whatsapp/webhook/media/${token}.png`, config.mediaBaseUrl);
          const caption = [
            `*Resumo · ${report.title}*`,
            `Entradas: ${currency.format(report.receitas)}`,
            `Gastos: ${currency.format(report.gastos)}`,
            `Saldo do período: ${currency.format(report.saldo)}`,
          ].join('\n');
          await sendVonageMessage(config, sender, { message_type: 'image', image: { url: url.href, caption } });
          return;
        } catch (error) {
          // Em um timeout o resultado do envio é desconhecido. Deixe o webhook tentar novamente.
          if (error.name === 'TimeoutError' || error.code === 'VONAGE_HTTP_429') throw error;
          images.delete(token);
          console.error('[whatsapp/vonage] Imagem indisponível:', error.code || error.name);
        }
      }
    }
    await sendVonageMessage(config, sender, { message_type: 'text', text });
  }

  router.get('/media/:token.png', (req, res) => {
    const { token } = req.params;
    const entry = images.get(token);
    res.set('Cache-Control', 'private, no-store');
    if (!entry || entry.expiresAt <= Date.now()) {
      images.delete(token);
      return res.sendStatus(404);
    }
    return res.type('png').send(entry.png);
  });
  router.use(express.raw({ type: 'application/json', limit: '256kb', inflate: false }));

  function verifiedPayload(req, res, next) {
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
    if (!authenticate(req, config)) return res.sendStatus(403);

    try {
      req.vonagePayload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }
    return next();
  }

  router.post('/', verifiedPayload, async (req, res) => {
    const message = readMessage(req.vonagePayload, config);
    if (!message) return res.sendStatus(200);

    try {
      await handleMessages([message], sendText ?? deliver);
      return res.sendStatus(200);
    } catch (error) {
      console.error('[whatsapp/vonage] Falha processando webhook:', error.code || error.name);
      return res.sendStatus(503);
    }
  });

  router.post('/status', verifiedPayload, (req, res) => {
    const event = req.vonagePayload;
    if (event?.channel === 'whatsapp' && event.from === config.botNumber) {
      if (['rejected', 'undeliverable'].includes(event.status)) {
        const code = Number(event.error?.code);
        console.error('[whatsapp/vonage] Entrega:', event.status, Number.isSafeInteger(code) ? code : '');
      } else if (event.status === 'delivered') {
        console.info('[whatsapp/vonage] Mensagem entregue.');
      }
    }
    return res.sendStatus(200);
  });
  return router;
}

module.exports = { createVonageWebhookRouter };
