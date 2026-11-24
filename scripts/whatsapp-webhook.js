// Para a apresentação, o túnel aponta para este processo. A API e as rotas
// de autenticação continuam no servidor local, fora do túnel.
const express = require('express');
const helmet = require('helmet');
const config = require('../src/config');
const { createWebhookRouter } = require('../src/routes/whatsapp.routes');
const { notFound, errorHandler } = require('../src/middleware/errorHandler');

if (!config.whatsapp.enabled) {
  console.error('Preencha WHATSAPP_* e defina WHATSAPP_ENABLED=true em .env.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use('/api/whatsapp/webhook', createWebhookRouter(config.whatsapp));
app.use(notFound);
app.use(errorHandler);
app.listen(3002, '127.0.0.1', () => {
  console.log('Webhook local disponível em http://127.0.0.1:3002/api/whatsapp/webhook');
});
