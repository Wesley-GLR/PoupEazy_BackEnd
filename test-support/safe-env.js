// Carregado ANTES de qualquer teste. Nunca ler o .env privado nem usar Gmail real.
Object.assign(process.env, {
  EMAIL_ENABLED: 'false', EMAIL_FROM: 'poupeazy@gmail.com',
  GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '', GMAIL_TEST_RECIPIENT: '',
  PASSWORD_RESET_URL: 'https://poup-eazy.vercel.app/redefinir-senha',
  WHATSAPP_ENABLED: 'false', PLUGGY_CLIENT_ID: '', PLUGGY_CLIENT_SECRET: '',
});
require('dotenv').config = () => ({ parsed: {} });
