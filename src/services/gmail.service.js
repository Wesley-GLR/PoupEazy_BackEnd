const { OAuth2Client } = require('google-auth-library');
const nodemailer = require('nodemailer');
const { GmailEmailError, normalizeEmailAddress } = require('../config/email');

const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONTENT_BYTES = 512 * 1024;
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']);

function createOAuthClient(settings) {
  const client = new OAuth2Client({
    clientId: settings.clientId,
    clientSecret: settings.clientSecret,
    // Evita interceptors internos que podem registrar respostas OAuth em modo debug.
    useAuthRequestParameters: false,
    transporterOptions: {
      timeout: REQUEST_TIMEOUT_MS,
      // O refresh interno habilita retry; zero tentativas extras limita o tempo total.
      retryConfig: { retry: 0 },
      maxRedirects: 0,
    },
  });
  client.setCredentials({ refresh_token: settings.refreshToken });
  return client;
}

function validateMessage(message) {
  const { to, subject, text, html } = message || {};
  const recipient = normalizeEmailAddress(to);
  if (!recipient || typeof subject !== 'string' || !subject.trim()
      || subject.length > 200 || /[\r\n]/.test(subject)
      || typeof text !== 'string' || !text.trim()
      || (html !== undefined && typeof html !== 'string')
      || Buffer.byteLength(text, 'utf8') + Buffer.byteLength(html || '', 'utf8') > MAX_CONTENT_BYTES) {
    throw new GmailEmailError('EMAIL_MESSAGE_INVALID');
  }
  return { to: { address: recipient }, subject: subject.trim(), text, ...(html === undefined ? {} : { html }) };
}

function createGmailService(settings, { authClient, fetchImpl = globalThis.fetch } = {}) {
  // A inicializacao desabilitada nao abre conexoes nem exige credenciais.
  if (!settings?.enabled) {
    return { send: async () => { throw new GmailEmailError('EMAIL_DISABLED'); } };
  }
  const oauth = authClient || createOAuthClient(settings);
  // Nodemailer apenas compoe MIME em memoria. Nenhum transporte SMTP e utilizado.
  const composer = nodemailer.createTransport({
    streamTransport: true, buffer: true, newline: 'windows',
    disableFileAccess: true, disableUrlAccess: true,
  });
  // Endereco explicito impede usar por acidente o token de outra caixa com "me".
  const sendUrl = `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(settings.fromAddress)}/messages/send`;

  async function send(message) {
    const content = validateMessage(message);
    let mime;
    try {
      mime = await composer.sendMail({ from: { name: 'PoupEazy', address: settings.fromAddress }, ...content });
    } catch {
      throw new GmailEmailError('EMAIL_MESSAGE_INVALID');
    }

    let accessToken;
    try {
      const result = await oauth.getAccessToken();
      accessToken = result.token;
    } catch (error) {
      const status = error.response?.status;
      // Nunca propagar error/cause/response: a biblioteca inclui tokens e segredo.
      throw new GmailEmailError(!status || status === 429 || status >= 500
        ? 'EMAIL_AUTH_TEMPORARY' : 'EMAIL_AUTH_FAILED');
    }
    if (!accessToken) throw new GmailEmailError('EMAIL_AUTH_FAILED');

    let response;
    let payload;
    try {
      // Sem retry ou redirect automatico: um envio com resposta perdida pode ter ocorrido.
      response = await fetchImpl(sendUrl, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: mime.message.toString('base64url') }),
      });
      payload = await response.json();
    } catch {
      throw new GmailEmailError('EMAIL_SEND_UNKNOWN');
    }

    if (response.status === 401) {
      // Permite obter acesso novo na proxima tentativa manual, sem reenviar agora.
      oauth.setCredentials({ refresh_token: settings.refreshToken });
      throw new GmailEmailError('EMAIL_AUTH_FAILED');
    }
    if (response.status === 429
        || (Array.isArray(payload?.error?.errors) && payload.error.errors.some(error => QUOTA_REASONS.has(error.reason)))) {
      throw new GmailEmailError('EMAIL_RATE_LIMITED');
    }
    if (response.status === 403) throw new GmailEmailError('EMAIL_PERMISSION_DENIED');
    if (response.status >= 500) throw new GmailEmailError('EMAIL_SEND_UNKNOWN');
    if (!response.ok) throw new GmailEmailError('EMAIL_SEND_REJECTED');
    if (!payload || typeof payload.id !== 'string' || !payload.id) throw new GmailEmailError('EMAIL_SEND_UNKNOWN');

    // Uma resposta aceita nao garante chegada a caixa de entrada do destinatario.
    return { id: payload.id, ...(typeof payload.threadId === 'string' ? { threadId: payload.threadId } : {}) };
  }

  return { send };
}

module.exports = { createGmailService, GmailEmailError };
