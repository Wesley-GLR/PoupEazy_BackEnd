const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function budgetAlertEmail(snapshot, tipo, resetUrl) {
  const month = `${String(snapshot.mes).padStart(2, '0')}/${snapshot.ano}`;
  const planned = money.format(Number(snapshot.valor_planejado));
  const spent = money.format(Number(snapshot.gasto_confirmado));
  const link = new URL('/perfil', resetUrl).toString();
  const budgetLink = new URL('/orcamento', resetUrl).toString();
  const safeBudgetLink = budgetLink.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeLink = link.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const title = tipo === 'excesso' ? 'Seu orçamento do mês foi ultrapassado' : `Seu orçamento atingiu o alerta de ${snapshot.percentual}%`;
  const message = tipo === 'excesso'
    ? 'Suas despesas confirmadas ultrapassaram 100% do valor planejado. Este aviso também cobre o limite personalizado, caso ele ainda não tenha sido avisado.'
    : `Suas despesas confirmadas atingiram pelo menos ${snapshot.percentual}% do valor planejado.`;
  return {
    to: snapshot.email, subject: `PoupEazy: ${tipo === 'excesso' ? 'orçamento ultrapassado' : 'alerta do orçamento'} de ${month}`,
    text: `Olá!\n\n${title}\n${message}\n\nMês: ${month}\nPlanejado: ${planned}\nDespesas confirmadas: ${spent}\n\n`
      + `Receitas não são descontadas desse cálculo. Confira seu orçamento no PoupEazy: ${budgetLink}\nVocê pode desativar estes e-mails ou mudar o percentual no perfil: ${link}\n\nEquipe PoupEazy`,
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2C2C2C;line-height:1.6">'
      + `<h1 style="font-size:24px">${title}</h1><p>${message}</p><p><strong>Mês:</strong> ${month}<br>`
      + `<strong>Planejado:</strong> ${planned}<br><strong>Despesas confirmadas:</strong> ${spent}</p>`
      + '<p>Receitas não são descontadas desse cálculo. Confira seu orçamento no PoupEazy.</p>'
      + `<p><a href="${safeBudgetLink}" style="display:inline-block;background:#0E5787;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Ver meu orçamento</a></p>`
      + `<p><a href="${safeLink}" style="color:#0E5787">Gerenciar alertas no perfil</a></p><p>Equipe PoupEazy</p></body></html>`,
  };
}
module.exports = { budgetAlertEmail };
