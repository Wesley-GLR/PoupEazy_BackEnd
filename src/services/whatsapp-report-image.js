const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { currency } = require('./whatsapp-text');

const formatDate = (value) => value.split('-').reverse().join('/');
const reportFont = 'PoupEazy Report';
const fontDirectory = path.join(__dirname, '../assets/fonts');
let regularFont;
let boldFont;

async function renderReportImage(report) {
  // O Render pode executar a API em um ambiente sem fontes de sistema.
  regularFont ??= GlobalFonts.registerFromPath(path.join(fontDirectory, 'LiberationSans-Regular.ttf'), reportFont);
  boldFont ??= GlobalFonts.registerFromPath(path.join(fontDirectory, 'LiberationSans-Bold.ttf'), reportFont);
  if (!regularFont || !boldFont) throw new Error('Não foi possível carregar a fonte do relatório.');

  const categories = report.categorias ?? [];
  const width = 800;
  const height = categories.length ? 340 + categories.length * 100 : 420;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  function rectangle(x, y, w, h, color) {
    context.fillStyle = color;
    context.fillRect(x, y, w, h);
  }

  function label(value, x, y, size, color, bold = false, maxWidth) {
    context.font = `${bold ? 'bold ' : ''}${size}px "${reportFont}"`;
    context.fillStyle = color;
    context.fillText(value, x, y, maxWidth);
  }

  rectangle(0, 0, width, height, '#f3f7f4');
  rectangle(0, 0, width, 156, '#143d34');
  label('PoupEazy', 40, 42, 22, '#c8e9d4', true);
  label(report.title, 40, 92, 40, '#ffffff', true);
  const interval = report.start && report.start !== report.end
    ? `${formatDate(report.start)} a ${formatDate(report.end)}`
    : `${report.start ? '' : 'Até '}${formatDate(report.end)}`;
  label(interval, 40, 126, 22, '#c8e9d4');

  for (const [index, [name, amount]] of [
    ['Entradas', report.receitas], ['Gastos', report.gastos], ['Saldo do período', report.saldo],
  ].entries()) {
    const x = 40 + 248 * index;
    rectangle(x, 180, 224, 88, '#ffffff');
    label(name, x + 14, 208, 19, '#365851');
    label(currency.format(amount), x + 14, 244, 27, '#143d34', true, 196);
  }

  label('Maiores gastos por categoria', 40, 316, 29, '#143d34', true);
  if (!categories.length) {
    label('Nenhuma despesa confirmada no período.', 40, 372, 22, '#365851');
  }

  categories.forEach(({ nome, total }, index) => {
    const y = 360 + 100 * index;
    const share = Number(total) / Number(report.gastos);
    const percent = share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
    label(nome.replace(/\s+/g, ' '), 40, y, 24, '#143d34', true, 440);
    context.textAlign = 'right';
    label(`${currency.format(total)}  ·  ${percent}`, 760, y, 23, '#143d34', false, 270);
    context.textAlign = 'left';
    rectangle(40, y + 16, 720, 16, '#d6e5dc');
    rectangle(40, y + 16, Math.max(2, Math.round(720 * share)), 16, '#25835a');
  });

  return canvas.encode('png');
}

module.exports = { renderReportImage };
