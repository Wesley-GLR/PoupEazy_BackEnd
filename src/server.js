const config = require('./config');
const { createApp } = require('./app');

const app = createApp();
app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`PoupEazy backend rodando na porta ${config.port} (${config.nodeEnv})`);
});
