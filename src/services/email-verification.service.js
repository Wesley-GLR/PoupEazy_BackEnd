const crypto = require('node:crypto');
const { emailVerificationEmail } = require('../emails/email-verification');

const hashVerificationToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function createVerificationChallenge() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashVerificationToken(token) };
}

function buildVerificationEmail(email, token, verificationUrl) {
  const link = new URL(verificationUrl);
  link.searchParams.set('token', token);
  return emailVerificationEmail(email, link.toString());
}

async function prepareEmailVerification({ database, email, verificationUrl }) {
  const challenge = createVerificationChallenge();
  // Emissao e cooldown atomicos, inclusive entre processos/IPs distintos.
  const { rows: [user] } = await database.query(
    `UPDATE usuarios SET verificacao_token_hash = $1, verificacao_expira_em = NOW() + INTERVAL '24 hours'
      WHERE LOWER(email) = $2 AND email_verificado_em IS NULL
        AND (verificacao_expira_em IS NULL OR verificacao_expira_em <= NOW() + INTERVAL '23 hours 59 minutes')
      RETURNING email`,
    [challenge.hash, email]
  );
  return user ? buildVerificationEmail(user.email, challenge.token, verificationUrl) : null;
}

async function consumeEmailVerification({ database, token }) {
  const { rowCount } = await database.query(
    `UPDATE usuarios SET email_verificado_em = NOW(), verificacao_token_hash = NULL, verificacao_expira_em = NULL
      WHERE verificacao_token_hash = $1 AND verificacao_expira_em > NOW()
        AND email_verificado_em IS NULL
      RETURNING id`,
    [hashVerificationToken(token)]
  );
  return rowCount === 1;
}

module.exports = { createVerificationChallenge, buildVerificationEmail, prepareEmailVerification, consumeEmailVerification };
