const PROJECT_EMAIL = 'poupeazy@gmail.com';
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

// Apenas mensagens controladas: erros OAuth podem carregar segredos na requisicao.
const ERROR_MESSAGES = Object.freeze({
  EMAIL_DISABLED: 'O envio de e-mails esta desativado. Configure EMAIL_ENABLED=true para testar.',
  EMAIL_CONFIG_INVALID: 'Revise as variaveis de e-mail descritas em .env.example. O remetente deve ser poupeazy@gmail.com.',
  EMAIL_MESSAGE_INVALID: 'Informe um destinatario unico, assunto e conteudo de e-mail validos.',
  EMAIL_AUTH_FAILED: 'O Google recusou a autorizacao. Confira as credenciais e reconecte a conta se necessario.',
  EMAIL_AUTH_TEMPORARY: 'Nao foi possivel renovar o acesso ao Gmail. Tente novamente mais tarde.',
  EMAIL_PERMISSION_DENIED: 'O Google recusou a permissao de envio. Confira a conta autorizada, o escopo gmail.send e a Gmail API.',
  EMAIL_RATE_LIMITED: 'O Gmail limitou os envios. Aguarde antes de tentar novamente.',
  EMAIL_SEND_REJECTED: 'O Gmail recusou a mensagem. Confira a configuracao e o destinatario.',
  EMAIL_SEND_UNKNOWN: 'Nao foi possivel confirmar o envio. Confira a pasta Enviados antes de repetir para evitar duplicatas.',
});

class GmailEmailError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'EMAIL_SEND_UNKNOWN';
    super(ERROR_MESSAGES[safeCode]);
    this.name = 'GmailEmailError';
    this.code = safeCode;
  }
}

function normalizeEmailAddress(value) {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  if (address.length > 254 || !EMAIL_PATTERN.test(address)) return null;
  return address;
}

// Independente de dotenv, banco ou config.js: tambem utilizado pelo teste CLI.
function readEmailConfig(env = process.env) {
  const flag = (env.EMAIL_ENABLED || 'false').trim().toLowerCase();
  if (!['true', 'false'].includes(flag)) throw new GmailEmailError('EMAIL_CONFIG_INVALID');
  if (flag === 'false') return Object.freeze({ enabled: false });

  const fromAddress = normalizeEmailAddress(env.EMAIL_FROM || PROJECT_EMAIL);
  const clientId = (env.GMAIL_CLIENT_ID || '').trim();
  const clientSecret = (env.GMAIL_CLIENT_SECRET || '').trim();
  const refreshToken = (env.GMAIL_REFRESH_TOKEN || '').trim();
  const testRecipient = normalizeEmailAddress(env.GMAIL_TEST_RECIPIENT || fromAddress);
  if (fromAddress !== PROJECT_EMAIL || !testRecipient
      || !/^[a-z0-9._-]+\.apps\.googleusercontent\.com$/i.test(clientId)
      || !clientSecret || /\s/.test(clientSecret) || !refreshToken || /\s/.test(refreshToken)) {
    throw new GmailEmailError('EMAIL_CONFIG_INVALID');
  }

  return Object.freeze({ enabled: true, fromAddress, clientId, clientSecret, refreshToken, testRecipient });
}

function readAppEmailUrl(env, variableName, fallback) {
  let url;
  try {
    url = new URL(env[variableName] || fallback);
  } catch {
    throw new GmailEmailError('EMAIL_CONFIG_INVALID');
  }
  const localDevelopment = ['development', 'test'].includes(env.NODE_ENV || 'development')
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && localDevelopment))
      || url.username || url.password || url.search || url.hash) {
    throw new GmailEmailError('EMAIL_CONFIG_INVALID');
  }
  return url.toString();
}

function readPasswordResetUrl(env = process.env) {
  return readAppEmailUrl(env, 'PASSWORD_RESET_URL', 'https://poup-eazy.vercel.app/redefinir-senha');
}

function readEmailVerificationUrl(env = process.env) {
  return readAppEmailUrl(env, 'EMAIL_VERIFICATION_URL', 'https://poup-eazy.vercel.app/confirmar-email');
}

module.exports = { readEmailConfig, readPasswordResetUrl, readEmailVerificationUrl, GmailEmailError, normalizeEmailAddress };
