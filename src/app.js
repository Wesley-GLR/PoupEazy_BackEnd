const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const profileRoutes = require('./routes/profile.routes');
const metasRoutes = require('./routes/metas.routes');
const orcamentosRoutes = require('./routes/orcamentos.routes');
const categoriasRoutes = require('./routes/categorias.routes');
const despesasRoutes = require('./routes/despesas.routes');
const notificacoesRoutes = require('./routes/notificacoes.routes');
const integracoesRoutes = require('./routes/integracoes.routes');
const pluggyRoutes = require('./routes/pluggy.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const { createWebhookRouter, createLinkRouter } = require('./routes/whatsapp.routes');

function createApp({ sendWhatsAppText } = {}) {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  const origins = config.corsOrigin === '*'
    ? '*'
    : config.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);

  app.use(helmet());
  app.use(cors({ origin: origins }));
  // O webhook precisa do corpo bruto para conferir a assinatura da Meta.
  if (config.whatsapp.enabled) {
    app.use('/api/whatsapp/webhook', createWebhookRouter(config.whatsapp, sendWhatsAppText));
  }
  app.use(express.json({ limit: config.jsonBodyLimit }));

  if (!config.isTest) {
    app.use(rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.max,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Muitas requisicoes. Tente novamente em alguns minutos.' },
    }));

    app.use('/api/auth', rateLimit({
      windowMs: config.rateLimit.windowMs,
      limit: config.rateLimit.authMax,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Muitas tentativas de autenticacao. Aguarde e tente novamente.' },
    }));
  }

  // Nao divulga ambiente, versao ou detalhes de infraestrutura.
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/metas', metasRoutes);
  app.use('/api/orcamentos', orcamentosRoutes);
  app.use('/api/categorias', categoriasRoutes);
  app.use('/api/despesas', despesasRoutes);
  app.use('/api/notificacoes', notificacoesRoutes);
  app.use('/api/integracoes', integracoesRoutes);
  app.use('/api/pluggy', pluggyRoutes);
  app.use('/api/relatorios', relatoriosRoutes);
  app.use('/api/whatsapp', createLinkRouter(config.whatsapp));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
