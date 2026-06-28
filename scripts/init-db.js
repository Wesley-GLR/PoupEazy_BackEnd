// Aplica o db/schema.sql no banco apontado por DATABASE_URL.
// Uso: npm run db:init
const fs = require('fs');
const path = require('path');
const { pool } = require('../src/db');

async function main() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // eslint-disable-next-line no-console
  console.log('[init-db] Aplicando db/schema.sql...');
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log('[init-db] Schema aplicado com sucesso.');
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[init-db] Falha ao aplicar o schema:', err);
  process.exit(1);
});
