require('dotenv').config();
const { readEmailConfig, readPasswordResetUrl, readEmailVerificationUrl } = require('./config/email');

const whatsappProvider = process.env.WHATSAPP_PROVIDER || 'meta';

// Centraliza a leitura e validacao das variaveis de ambiente.
// Falhar cedo (no boot) e melhor do que descobrir uma var faltando no meio de uma requisicao.
const config = {
  port: Number(process.env.PORT) || 3001,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  email: readEmailConfig(),
  passwordResetUrl: readPasswordResetUrl(),
  emailVerificationUrl: readEmailVerificationUrl(),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '100kb',
  trustProxy: process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1',
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX) || 300,
    authMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  },
  databaseSsl: {
    mode: (process.env.DATABASE_SSL || 'auto').toLowerCase(),
    rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true',
  },
  whatsapp: {
    provider: whatsappProvider,
    enabled: process.env.WHATSAPP_ENABLED === 'true',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v23.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    botNumber: whatsappProvider === 'vonage_sandbox'
      ? process.env.VONAGE_WHATSAPP_NUMBER
      : process.env.WHATSAPP_BOT_NUMBER,
    apiKey: process.env.VONAGE_API_KEY,
    apiSecret: process.env.VONAGE_API_SECRET,
    signatureSecret: process.env.VONAGE_SIGNATURE_SECRET,
    mediaBaseUrl: process.env.VONAGE_MEDIA_BASE_URL || null,
    testRecipient: process.env.WHATSAPP_TEST_RECIPIENT_BR || null,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    appSecret: process.env.WHATSAPP_APP_SECRET,
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  },
  pluggy: {
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
    oauthRedirectUri: process.env.PLUGGY_OAUTH_REDIRECT_URI || undefined,
    syncMaxTransactions: Number(process.env.PLUGGY_SYNC_MAX_TRANSACTIONS) || 10000,
  },
};

config.isDev = config.nodeEnv !== 'production';
config.isTest = config.nodeEnv === 'test';

if (!['auto', 'require', 'disable'].includes(config.databaseSsl.mode)) {
  // eslint-disable-next-line no-console
  console.error('[config] DATABASE_SSL deve ser auto, require ou disable.');
  process.exit(1);
}

const obrigatorias = ['DATABASE_URL', 'JWT_SECRET'];
const faltando = obrigatorias.filter((nome) => !process.env[nome]);
if (faltando.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    `[config] Variaveis de ambiente obrigatorias ausentes: ${faltando.join(', ')}.\n` +
      'Copie .env.example para .env e preencha os valores.'
  );
  process.exit(1);
}

if (config.nodeEnv === 'production' && Buffer.byteLength(config.jwtSecret, 'utf8') < 32) {
  // eslint-disable-next-line no-console
  console.error('[config] JWT_SECRET deve ter pelo menos 32 bytes em producao.');
  process.exit(1);
}

if (config.whatsapp.enabled) {
  const {
    provider, botNumber, testRecipient, apiVersion, phoneNumberId, accessToken, appSecret, verifyToken,
    apiKey, apiSecret, signatureSecret, mediaBaseUrl,
  } = config.whatsapp;
  const commonInvalid = !/^[1-9]\d{6,14}$/.test(botNumber)
    || (testRecipient && !/^55[1-9]\d9\d{8}$/.test(testRecipient));
  const metaInvalid = !/^v\d+\.\d+$/.test(apiVersion) || !/^\d{1,32}$/.test(phoneNumberId)
    || !accessToken || !appSecret || !verifyToken;
  const vonageInvalid = !apiKey || !apiSecret || !signatureSecret
    || (mediaBaseUrl && !/^https:\/\/[a-z0-9.-]+\/?$/i.test(mediaBaseUrl));
  if (commonInvalid || !['meta', 'vonage_sandbox'].includes(provider)
      || (provider === 'meta' && metaInvalid) || (provider === 'vonage_sandbox' && vonageInvalid)) {
    console.error('[config] Revise as variáveis de WhatsApp em .env.example.');
    process.exit(1);
  }
}

module.exports = config;
