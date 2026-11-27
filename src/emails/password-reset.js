function passwordResetEmail(to, link) {
  const safeLink = link.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  return {
    to,
    subject: 'Redefina sua senha do PoupEazy',
    text: 'Olá!\n\nRecebemos uma solicitação para redefinir sua senha do PoupEazy.\n'
      + `Abra este link para escolher uma nova senha:\n${link}\n\n`
      + 'O link expira em 1 hora e pode ser usado uma única vez.\n'
      + 'Se você não fez essa solicitação, ignore este e-mail. Sua senha continua a mesma.\n\n'
      + 'Equipe PoupEazy',
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2C2C2C;line-height:1.6">'
      + '<h1 style="font-size:24px">Redefina sua senha</h1>'
      + '<p>Recebemos uma solicitação para redefinir sua senha do PoupEazy.</p>'
      + `<p><a href="${safeLink}" style="display:inline-block;background:#0E5787;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Escolher nova senha</a></p>`
      + '<p>O link expira em <strong>1 hora</strong> e pode ser usado uma única vez.</p>'
      + '<p>Se você não fez essa solicitação, ignore este e-mail. Sua senha continua a mesma.</p>'
      + '<p>Equipe PoupEazy</p></body></html>',
  };
}

module.exports = { passwordResetEmail };
