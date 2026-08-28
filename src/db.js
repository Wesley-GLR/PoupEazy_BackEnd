const { Pool, types } = require('pg');
const config = require('./config');

// Colunas DATE (OID 1082) devem voltar como string "YYYY-MM-DD", e nao como objeto Date.
// Sem isso, o JSON.stringify converteria para um timestamp ISO completo
// (ex.: "2026-06-15T03:00:00.000Z"), quebrando o frontend que espera apenas a data
// (formatDate, inputs <input type="date">, calculo de dias restantes).
types.setTypeParser(1082, (value) => value);

// SSL pode ser controlado explicitamente. O modo "auto" preserva o comportamento
// esperado: usa SSL em producao ou quando a connection string o solicita, mas
// respeita sslmode=disable para ambientes locais.
const sslDesabilitadoNaUrl = /sslmode=disable/i.test(config.databaseUrl || '');
const sslExigidoNaUrl = /sslmode=require/i.test(config.databaseUrl || '');
const precisaSsl =
  config.databaseSsl.mode === 'require' ||
  (config.databaseSsl.mode === 'auto' && !sslDesabilitadoNaUrl && (!config.isDev || sslExigidoNaUrl));

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: precisaSsl
    ? { rejectUnauthorized: config.databaseSsl.rejectUnauthorized }
    : false,
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
