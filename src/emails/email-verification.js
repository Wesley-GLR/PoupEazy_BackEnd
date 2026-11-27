function emailVerificationEmail(to, link) {
  const safeLink = link.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  return {
    to,
    subject: 'Confirme seu e-mail no PoupEazy',
    text: 'Olá!\n\nConfirme seu e-mail para começar a usar sua conta do PoupEazy.\n'
      + `Abra este link e confirme na página:\n${link}\n\n`
      + 'O link expira em 24 horas e pode ser usado uma única vez.\n'
      + 'Se você não criou essa conta, ignore este e-mail.\n\nEquipe PoupEazy',
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2C2C2C;line-height:1.6">'
      + '<h1 style="font-size:24px">Confirme seu e-mail</h1>'
      + '<p>Falta confirmar seu e-mail para começar a usar o PoupEazy.</p>'
      + `<p><a href="${safeLink}" style="display:inline-block;background:#0E5787;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Abrir confirmação</a></p>`
      + '<p>Ao abrir a página, confirme seu e-mail pelo botão. O link expira em <strong>24 horas</strong> e pode ser usado uma única vez.</p>'
      + '<p>Se você não criou essa conta, ignore este e-mail.</p><p>Equipe PoupEazy</p></body></html>',
  };
}

module.exports = { emailVerificationEmail };
