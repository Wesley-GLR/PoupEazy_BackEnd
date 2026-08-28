require('dotenv').config();

// Centraliza a leitura e validacao das variaveis de ambiente.
// Falhar cedo (no boot) e melhor do que descobrir uma var faltando no meio de uma requisicao.
const config = {
  port: Number(process.env.PORT) || 3001,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
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

module.exports = config;
