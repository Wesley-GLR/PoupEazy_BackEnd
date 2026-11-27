const config = require('./config');
const { createApp } = require('./app');
const db = require('./db');
const { createGmailService } = require('./services/gmail.service');
const { createEmailAlertsWorker } = require('./services/email-alerts.worker');

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`PoupEazy backend rodando na porta ${config.port} (${config.nodeEnv})`);
});

if (config.email.enabled) {
  createEmailAlertsWorker({
    database: db, sendEmail: createGmailService(config.email).send,
    enabled: true, resetUrl: config.passwordResetUrl,
  }).start();
}
