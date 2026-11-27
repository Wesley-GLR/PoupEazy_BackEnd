const path = require('node:path');
const PDFDocument = require('pdfkit');
const { ApiError } = require('../middleware/errorHandler');
const MAX_ATTACHMENTS_BYTES = 5 * 1024 * 1024;
const TITLES = { resumo: 'Resumo do período', transacoes: 'Transações confirmadas', categorias: 'Por categoria', orcamentos: 'Orçamentos', metas: 'Metas' };
const column = (key, label, type = 'text') => ({ key, label, type });
const COLUMNS = {
  resumo: [column('receitas','Receitas','money'),column('despesas','Despesas','money'),column('saldo','Resultado do período','money'),column('transacoes','Transações','number')],
  transacoes: [column('data','Data','date'),column('descricao','Descrição'),column('categoria','Categoria'),column('tipo','Tipo'),column('valor','Valor','money'),column('origem','Origem')],
  categorias: [column('categoria','Categoria'),column('tipo','Tipo'),column('total','Total','money'),column('quantidade','Quantidade','number')],
  orcamentos: [column('competencia','Mês'),column('valor_planejado','Planejado integral','money'),column('gasto_periodo','Despesas no recorte','money'),column('inicio_coberto','Início coberto','date'),column('fim_coberto','Fim coberto','date'),column('mes_parcial','Mês parcial','boolean')],
  metas: [column('nome','Meta'),column('status','Status atual'),column('valor_objetivo','Objetivo','money'),column('valor_atual','Saldo atual','money'),column('aportes_periodo','Aportes no período','money'),column('retiradas_periodo','Retiradas no período','money'),column('movimento_periodo','Movimento líquido','money'),column('data_limite','Prazo','date')],
};
function limitError() { return new ApiError(422, 'Os arquivos ultrapassam 5 MiB. Reduza o período ou as seções.', 'REPORT_LIMIT_EXCEEDED'); }
function money(value, csv = false) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) return String(value);
  const decimals = (match[3] || '').padEnd(2,'0');
  return csv ? `${match[1]}${match[2]},${decimals}` : `${match[1]}R$ ${new Intl.NumberFormat('pt-BR').format(BigInt(match[2]))},${decimals}`;
}
function dateText(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value).split('-').reverse().join('/') : String(value ?? ''); }
function cellValue(row, col, csv = false) {
  const value = row[col.key];
  if (col.type === 'money') return money(value, csv);
  if (col.type === 'date') return dateText(value);
  if (col.type === 'boolean') return value ? 'Sim' : 'Não';
  return String(value ?? '');
}
function csvCell(value, untrusted = true) {
  let text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'');
  if (untrusted && /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
function reportTables(report) {
  return report.secoes.map((key) => ({ key, title: TITLES[key], columns: COLUMNS[key],
    note: key === 'orcamentos' ? 'Planejado integral do mês, sem rateio. Despesas brutas confirmadas somente no recorte indicado.'
      : key === 'metas' ? 'Status e saldos atuais na exportação; aportes e retiradas apenas no período. Não representa posição histórica.'
        : 'Valores de transações confirmadas no período selecionado.',
    rows: key === 'resumo' ? [report.dados.resumo] : key === 'orcamentos'
      ? report.dados.orcamentos.map((row) => ({ ...row, competencia: `${String(row.mes).padStart(2,'0')}/${row.ano}` })) : report.dados[key],
  }));
}
function renderCsv(table) {
  const lines = [table.columns.map((col) => csvCell(col.label)).join(';')];
  for (const row of table.rows) lines.push(table.columns.map((col) => csvCell(cellValue(row,col,true), col.type === 'text' || col.type === 'date')).join(';'));
  return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n','utf8');
}

async function renderPdf(report, tables) {
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, size: 'A4', margins: { top: 42, bottom: 42, left: 42, right: 42 }, info: { Title: 'Relatório PoupEazy', Author: 'PoupEazy' } });
  doc.registerFont('Inter', path.join(__dirname,'../../assets/fonts/Inter_400Regular.ttf'));
  doc.registerFont('InterSemiBold', path.join(__dirname,'../../assets/fonts/Inter_600SemiBold.ttf'));
  let bytes = 0, missingGlyph = false;
  const chunks = [];
  const finished = new Promise((resolve,reject) => {
    doc.on('data', (chunk) => { bytes += chunk.length; if (bytes > MAX_ATTACHMENTS_BYTES) doc.destroy(limitError()); else chunks.push(chunk); });
    doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
  });
  function safe(value) {
    const face = doc._font.font;
    return [...String(value ?? '').replace(/[\u0000-\u001F\u007F]/g,' ')].map((character) => {
      if (face.hasGlyphForCodePoint(character.codePointAt(0))) return character;
      missingGlyph = true; return '?';
    }).join('');
  }
  for (const table of tables) {
    const landscape = table.columns.length > 6;
    const ratios = table.key === 'transacoes' ? [.12,.30,.19,.10,.14,.15] : table.key === 'metas'
      ? [.20,.10,.12,.12,.11,.11,.12,.12] : table.key === 'categorias' ? [.45,.16,.23,.16] : table.columns.map(() => 1/table.columns.length);
    let widths, y;
    function page() {
      doc.addPage({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: 42, bottom: 42, left: 42, right: 42 } });
      const width = doc.page.width - 84;
      const totalRatio = ratios.reduce((sum,ratio) => sum + ratio,0);
      widths = ratios.map((ratio) => ratio / totalRatio * width);
      doc.font('InterSemiBold').fontSize(21).fillColor('#0E5787').text('PoupEazy',42,35);
      doc.font('Inter').fontSize(9).fillColor('#5E6872').text(`${dateText(report.data_inicio)} a ${dateText(report.data_fim)} | Relatório pessoal`,42,66,{width});
      doc.font('InterSemiBold').fontSize(15).fillColor('#2C2C2C').text(table.title,42,91,{width});
      doc.font('Inter').fontSize(8.5).fillColor('#5E6872').text(table.note,42,115,{width});
      y = doc.y + 15;
      doc.font('InterSemiBold').fontSize(8);
      const height = Math.max(...table.columns.map((col,index) => doc.heightOfString(col.label,{width:widths[index]-12}))) + 14;
      doc.rect(42,y,width,height).fill('#E8F1F7');
      let x = 42;
      table.columns.forEach((col,index) => { doc.fillColor('#0E5787').text(col.label,x+6,y+6,{width:widths[index]-12}); x+=widths[index]; });
      y += height;
    }
    page();
    if (!table.rows.length) { doc.font('Inter').fontSize(10).fillColor('#5E6872').text('Nenhum registro nesta seção.',48,y+15); }
    table.rows.forEach((row,index) => {
      doc.font('Inter').fontSize(8.3);
      const values = table.columns.map((col) => safe(cellValue(row,col)));
      const height = Math.max(23,...values.map((value,i) => doc.heightOfString(value,{width:widths[i]-12})+14));
      if (y + height > doc.page.height - doc.page.margins.bottom - 17) page();
      doc.font('Inter').fontSize(8.3);
      if (index % 2 === 0) doc.rect(42,y,doc.page.width-84,height).fill('#F7F9FA');
      let x = 42;
      values.forEach((value,i) => { doc.fillColor('#2C2C2C').text(value,x+6,y+7,{width:widths[i]-12,link:null}); x += widths[i]; });
      y += height;
    });
  }
  const range = doc.bufferedPageRange();
  const generated = new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(report.gerado_em));
  for (let i=0;i<range.count;i++) {
    doc.switchToPage(i); const bottom = doc.page.margins.bottom; doc.page.margins.bottom = 0;
    doc.font('Inter').fontSize(7).fillColor('#5E6872').text(`Gerado em ${generated} (Brasília) | ${i+1}/${range.count}`,42,doc.page.height-31,{width:doc.page.width-84,lineBreak:false});
    if (missingGlyph) doc.text('Caracteres sem glifo foram substituídos por ?. O CSV preserva o texto Unicode.',42,doc.page.height-21,{width:doc.page.width-84,lineBreak:false});
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return finished;
}
async function renderReportAttachments(report, formatos) {
  const tables = reportTables(report);
  const range = `${report.data_inicio}-${report.data_fim}`;
  const attachments = [];
  if (formatos.includes('pdf')) attachments.push({ filename: `poupeazy-relatorio-${range}.pdf`, content: await renderPdf(report,tables), contentType: 'application/pdf' });
  if (formatos.includes('csv')) for (const table of tables) attachments.push({ filename: `poupeazy-${table.key}-${range}.csv`, content: renderCsv(table), contentType: 'text/csv; charset=utf-8' });
  if (attachments.reduce((sum,file) => sum+file.content.length,0)>MAX_ATTACHMENTS_BYTES) throw limitError();
  return attachments;
}
module.exports = { renderReportAttachments, reportTables, csvCell, MAX_ATTACHMENTS_BYTES };
