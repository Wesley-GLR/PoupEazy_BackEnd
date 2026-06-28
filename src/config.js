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
  pluggy: {
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  },
};

config.isDev = config.nodeEnv !== 'production';

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

module.exports = config;
