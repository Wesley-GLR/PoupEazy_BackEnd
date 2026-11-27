const path = require('node:path');

// O teste independe da API e do banco, mesmo quando iniciado de outra pasta.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { readEmailConfig } = require('../src/config/email');
const { createGmailService, GmailEmailError } = require('../src/services/gmail.service');

// Nao propagar mensagens/causas de bibliotecas: podem conter credenciais ou MIME.
const SAFE_ERRORS = Object.freeze({
  EMAIL_DISABLED: 'O envio esta desabilitado. Configure EMAIL_ENABLED=true para este teste.',
  EMAIL_CONFIG_INVALID: 'Revise a configuracao de e-mail no ambiente local.',
  EMAIL_MESSAGE_INVALID: 'A mensagem de teste ou seu destinatario nao e valido.',
  EMAIL_AUTH_FAILED: 'O Google recusou a autorizacao. Revise as credenciais e reconecte a conta se necessario.',
  EMAIL_AUTH_TEMPORARY: 'Nao foi possivel obter a autorizacao agora. Tente novamente mais tarde.',
  EMAIL_PERMISSION_DENIED: 'O Google recusou a permissao de envio. Confira a conta autorizada, o escopo gmail.send e a Gmail API.',
  EMAIL_RATE_LIMITED: 'O limite de envio foi atingido. Aguarde antes de tentar novamente.',
  EMAIL_SEND_REJECTED: 'O Gmail recusou a mensagem de teste.',
  EMAIL_SEND_UNKNOWN: 'O resultado do envio e incerto. Confira a pasta Enviados antes de repetir o teste.',
});

async function main() {
  if (process.argv.length > 2) {
    console.error('[email:test] Este comando nao aceita argumentos. Use GMAIL_TEST_RECIPIENT no ambiente local.');
    process.exitCode = 1;
    return;
  }

  const settings = readEmailConfig(process.env);
  if (!settings.enabled) {
    console.error(`[email:test] EMAIL_DISABLED: ${SAFE_ERRORS.EMAIL_DISABLED}`);
    process.exitCode = 1;
    return;
  }

  await createGmailService(settings).send({
    to: settings.testRecipient,
    subject: 'PoupEazy - teste de envio de e-mail',
    text: 'Ola!\n\nEsta e uma mensagem de teste do envio de e-mails do PoupEazy.\n'
      + 'Ela nao altera sua conta e nao contem dados financeiros.\n\n'
      + 'Voce nao precisa responder a esta mensagem.\n\nEquipe PoupEazy',
  });

  console.log('[email:test] O Gmail aceitou a mensagem de teste.');
  console.log('[email:test] Confira a caixa de entrada, a pasta Enviados e o spam. A aceitacao nao garante a entrega.');
}

main().catch((error) => {
  if (error instanceof GmailEmailError && Object.hasOwn(SAFE_ERRORS, error.code)) {
    console.error(`[email:test] ${error.code}: ${SAFE_ERRORS[error.code]}`);
  } else {
    console.error('[email:test] Nao foi possivel concluir o teste. Revise a configuracao local e tente novamente.');
  }
  process.exitCode = 1;
});
