const express = require('express');
const cors = require('cors');
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

const app = express();

// CORS: aceita uma ou varias origens separadas por virgula (ou * para liberar tudo em dev).
const origins = config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((o) => o.trim());
app.use(cors({ origin: origins }));
app.use(express.json());

// Healthcheck simples (util para o Render saber que o servico subiu).
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: config.nodeEnv, time: new Date().toISOString() });
});

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

app.use(notFound);
app.use(errorHandler);

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`PoupEazy backend rodando na porta ${config.port} (${config.nodeEnv})`);
});
