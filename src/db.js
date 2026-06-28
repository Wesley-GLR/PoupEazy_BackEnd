const { Pool, types } = require('pg');
const config = require('./config');

// Colunas DATE (OID 1082) devem voltar como string "YYYY-MM-DD", e nao como objeto Date.
// Sem isso, o JSON.stringify converteria para um timestamp ISO completo
// (ex.: "2026-06-15T03:00:00.000Z"), quebrando o frontend que espera apenas a data
// (formatDate, inputs <input type="date">, calculo de dias restantes).
types.setTypeParser(1082, (value) => value);

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
