function passwordChangedEmail(to, resetUrl, changedAt = new Date()) {
  const recoveryLink = new URL('/esqueci-senha', resetUrl).toString();
  const safeLink = recoveryLink.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const occurredAt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(changedAt);
  return {
    to,
    subject: 'Sua senha do PoupEazy foi alterada',
    text: 'Olá!\n\nA senha da sua conta do PoupEazy foi alterada.\n'
      + `Data e hora: ${occurredAt} (horário de Brasília, America/Sao_Paulo).\n\n`
      + 'Se foi você, nenhuma ação é necessária.\n'
      + 'Se não reconhece essa alteração, solicite a recuperação da sua conta:\n'
      + `${recoveryLink}\n\nPrecisa de ajuda? Entre em contato com poupeazy@gmail.com.\n\nEquipe PoupEazy`,
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2C2C2C;line-height:1.6">'
      + '<h1 style="font-size:24px">Sua senha foi alterada</h1>'
      + '<p>A senha da sua conta do PoupEazy foi alterada.</p>'
      + `<p><strong>Data e hora:</strong> ${occurredAt} (horário de Brasília, America/Sao_Paulo).</p>`
      + '<p>Se foi você, nenhuma ação é necessária.</p>'
      + '<p>Se não reconhece essa alteração, solicite a recuperação da sua conta:</p>'
      + `<p><a href="${safeLink}" style="display:inline-block;background:#0E5787;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Recuperar minha conta</a></p>`
      + '<p>Precisa de ajuda? <a href="mailto:poupeazy@gmail.com">poupeazy@gmail.com</a></p>'
      + '<p>Equipe PoupEazy</p></body></html>',
  };
}

module.exports = { passwordChangedEmail };
