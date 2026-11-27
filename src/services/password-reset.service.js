const crypto = require('node:crypto');
const { passwordResetEmail } = require('../emails/password-reset');

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function preparePasswordReset({ database, email, resetUrl }) {
  const token = crypto.randomBytes(32).toString('hex');
  // A emissao e o intervalo minimo de 60 segundos sao atomicos entre IPs/processos.
  // A validade de 1h tambem permite derivar a hora de emissao sem nova coluna.
  const { rows: [user] } = await database.query(
    `UPDATE usuarios SET reset_token = $1, reset_expira_em = NOW() + INTERVAL '1 hour'
      WHERE LOWER(email) = $2
        AND (reset_expira_em IS NULL OR reset_expira_em <= NOW() + INTERVAL '59 minutes')
      RETURNING email`,
    [hashResetToken(token), email]
  );
  if (!user) return null;
  const link = new URL(resetUrl);
  link.searchParams.set('token', token);
  return passwordResetEmail(user.email, link.toString());
}

async function consumePasswordReset({ database, token, passwordHash }) {
  // O proprio UPDATE revalida e consome o token, inclusive em resets concorrentes.
  const { rows: [user] } = await database.query(
    `UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_expira_em = NULL
      WHERE reset_token = $2 AND reset_expira_em > NOW()
      RETURNING id, email`,
    [passwordHash, hashResetToken(token)]
  );
  return user || null;
}

module.exports = { preparePasswordReset, consumePasswordReset, hashResetToken };
