const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pool } = require('../src/db');

async function main() {
  const client = await pool.connect();
  try {
    // A trava de sessão também cobre as transações declaradas nos arquivos SQL.
    await client.query('SELECT pg_advisory_lock(73542, 1)');
    for (const migration of ['005_whatsapp.sql', '006_whatsapp_report.sql']) {
      const sql = await readFile(path.join(__dirname, '../db/migrations', migration), 'utf8');
      await client.query(sql);
      console.log(`[whatsapp] Migração aplicada: ${migration}`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    // Fechar a conexão libera a trava mesmo após falha parcial de uma migração.
    client.release(true);
  }
}

main()
  .catch((error) => {
    console.error('[whatsapp] Falha nas migrações:', error.code || error.name);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
