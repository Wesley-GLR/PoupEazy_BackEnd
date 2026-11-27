function toCents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('invalid-money');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}
function formatCents(value) {
  return `R$ ${new Intl.NumberFormat('pt-BR').format(value / 100n)},${String(value % 100n).padStart(2, '0')}`;
}
function financialEventsEmail(to, tipo, rows, resetUrl) {
  const isGoal = tipo === 'meta_concluida';
  const single = rows.length === 1;
  const label = tipo === 'despesa' ? (single ? 'despesa' : 'despesas')
    : tipo === 'receita' ? (single ? 'receita' : 'receitas') : (single ? 'meta concluída' : 'metas concluídas');
  const total = rows.reduce((sum, row) => sum + toCents(isGoal ? row.valor_referencia : row.valor_evento), 0n);
  const summary = `${rows.length} ${label}. ${isGoal ? 'Soma dos objetivos' : 'Valor total'}: ${formatCents(total)}.`;
  const samples = rows.slice(0, 3).map((row) => `${row.data_exibicao}: ${formatCents(toCents(isGoal ? row.valor_referencia : row.valor_evento))}`);
  const settingsLink = new URL('/perfil', resetUrl).toString();
  const detailsLink = new URL(isGoal ? '/metas' : '/transacoes', resetUrl).toString();
  const safeLink = settingsLink.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const safeDetailsLink = detailsLink.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  return {
    to, subject: `PoupEazy: ${rows.length} ${label}`,
    text: `Olá!\n\n${summary}\n${samples.join('\n')}\n\nConfira os detalhes: ${detailsLink}\nGerencie ou desative estes avisos no seu perfil: ${settingsLink}\n\nEquipe PoupEazy`,
    html: '<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#2C2C2C;line-height:1.6">'
      + `<h1 style="font-size:24px">Novidades no PoupEazy</h1><p>${summary}</p><ul>${samples.map((sample) => `<li>${sample}</li>`).join('')}</ul>`
      + `<p><a style="display:inline-block;background:#0E5787;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none" href="${safeDetailsLink}">${isGoal ? 'Ver metas' : 'Ver transações'}</a></p>`
      + `<p><a style="color:#0E5787" href="${safeLink}">Gerenciar avisos no perfil</a></p><p>Equipe PoupEazy</p></body></html>`,
  };
}
module.exports = { financialEventsEmail };
