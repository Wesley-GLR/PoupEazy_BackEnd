// Disposable local API used only for report screenshots/E2E demonstrations.
// An explicit loopback-only database URL is mandatory; .env cannot select it.
const fs = require('node:fs');
const path = require('node:path');
const databaseUrl = process.env.REPORT_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Defina REPORT_TEST_DATABASE_URL para o banco local descartavel.');
const parsed = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/poupeazy_report_test') {
  throw new Error('A API de evidencias aceita somente loopback e banco poupeazy_report_test.');
}
Object.assign(process.env, {
  DATABASE_URL: databaseUrl, DATABASE_SSL: 'disable', NODE_ENV: 'test',
  JWT_SECRET: 'report-local-api-only-never-use-in-production',
  PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '', CORS_ORIGIN: '*',
  PORT: process.env.REPORT_TEST_API_PORT || '3002', TRUST_PROXY: 'false',
});
const db = require('../src/db');
const { createApp } = require('../src/app');

async function main() {
  await db.query(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const server = createApp().listen(Number(process.env.PORT), '127.0.0.1', () => {
    console.log(`API de testes local pronta na porta ${process.env.PORT}; banco descartavel; Pluggy desabilitada.`);
  });
  const stop = () => server.close(async () => { await db.pool.end(); process.exit(0); });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
main().catch((error) => { console.error(error.message); process.exit(1); });
