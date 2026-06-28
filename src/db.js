const { Pool } = require('pg');
const config = require('./config');

// Em provedores gerenciados (Neon, Render) a conexao normalmente exige SSL.
// Em desenvolvimento local (docker) nao usamos SSL.
const precisaSsl = !config.isDev || /sslmode=require/.test(config.databaseUrl || '');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: precisaSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Erro inesperado no pool do PostgreSQL:', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  // Util para transacoes (ex.: cadastro cria usuario + profile juntos).
  getClient: () => pool.connect(),
  pool,
};
