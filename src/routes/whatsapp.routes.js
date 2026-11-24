const express = require('express');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { createVonageWebhookRouter } = require('./whatsapp-vonage.routes');
const { linkStatus, createLinkCode, unlink, handleMessages } = require('../services/whatsapp.service');

function equalSecret(left, right) {
  if (typeof left !== 'string') return false;
  const actual = Buffer.from(left);
  const expected = Buffer.from(right);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function readMessages(payload, phoneNumberId, now = Date.now()) {
  const messages = [];
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) return messages;

  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      const value = change?.value;
      if (change?.field !== 'messages' || value?.metadata?.phone_number_id !== phoneNumberId
          || !Array.isArray(value.messages)) continue;

      for (const message of value.messages) {
        const timestamp = Number(message?.timestamp);
        const age = now - timestamp * 1000;
        if (message?.type !== 'text' || typeof message.text?.body !== 'string' || message.text.body.length > 4096
            || typeof message.id !== 'string' || !/^wamid\.[A-Za-z0-9+/_=-]{1,249}$/.test(message.id)
            || typeof message.from !== 'string' || !/^[1-9]\d{6,14}$/.test(message.from)
            || !Number.isSafeInteger(timestamp) || age > 24 * 60 * 60 * 1000 || age < -60_000) continue;
        messages.push({ id: message.id, sender: message.from, text: message.text.body, timestamp });
      }
    }
  }
  return messages.sort((first, second) => first.timestamp - second.timestamp);
}

async function sendMetaText(config, sender, text) {
  // A lista de teste brasileira pode exigir o nono dígito, omitido no ID recebido.
  // Só adapta o celular de teste configurado quando os demais dígitos coincidem.
  const { testRecipient } = config;
  const alternateId = testRecipient && testRecipient.slice(0, 4) + testRecipient.slice(5);
  const to = sender === alternateId ? testRecipient : sender;
  const response = await fetch(
    `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
      signal: AbortSignal.timeout(5000),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(`A Meta recusou o envio pelo WhatsApp (HTTP ${response.status}).`);
    if (Number.isSafeInteger(body?.error?.code)) error.code = `META_${body.error.code}`;
    throw error;
  }
  await response.body?.cancel();
}

function createWebhookRouter(config, sendText) {
  if (config.provider === 'vonage_sandbox') return createVonageWebhookRouter(config, sendText);

  const deliver = sendText ?? ((sender, text) => sendMetaText(config, sender, text));
  const router = express.Router();
  router.get('/', (req, res) => {
    const { 'hub.mode': mode, 'hub.verify_token': verifyToken, 'hub.challenge': challenge } = req.query;
    if (mode !== 'subscribe' || !equalSecret(verifyToken, config.verifyToken)
        || typeof challenge !== 'string' || !/^\d{1,32}$/.test(challenge)) return res.sendStatus(403);
    return res.type('text/plain').send(challenge);
  });

  router.post('/', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) return res.sendStatus(415);
    const signature = `sha256=${createHmac('sha256', config.appSecret).update(req.body).digest('hex')}`;
    if (!equalSecret(req.get('X-Hub-Signature-256'), signature)) return res.sendStatus(403);

    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.sendStatus(400);
    }

    try {
      await handleMessages(readMessages(payload, config.phoneNumberId), deliver);
      return res.sendStatus(200);
    } catch (err) {
      console.error('[whatsapp] Falha processando webhook:', err.code || err.name);
      return res.sendStatus(503);
    }
  });
  return router;
}

function createLinkRouter(config) {
  const router = express.Router();
  router.use(auth);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/vinculo', async (req, res, next) => {
    try {
      return res.json({
        habilitado: config.enabled,
        vinculado: config.enabled && await linkStatus(req.userId),
        url: config.enabled ? `https://wa.me/${config.botNumber}?text=menu` : null,
      });
    } catch (err) {
      return next(err);
    }
  });

  router.use((req, res, next) => config.enabled ? next() : next(new ApiError(503, 'WhatsApp indisponível neste ambiente.')));
  router.post('/vinculo', async (req, res, next) => {
    try {
      const { code, expiresAt } = await createLinkCode(req.userId);
      const text = encodeURIComponent(`vincular ${code}`);
      return res.status(201).json({ url: `https://wa.me/${config.botNumber}?text=${text}`, expiresAt });
    } catch (err) {
      return next(err);
    }
  });

  router.delete('/vinculo', async (req, res, next) => {
    try {
      await unlink(req.userId);
      return res.status(204).end();
    } catch (err) {
      return next(err);
    }
  });
  return router;
}

module.exports = { createWebhookRouter, createLinkRouter };
