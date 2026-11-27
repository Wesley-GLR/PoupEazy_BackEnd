const path = require('node:path');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { currency } = require('./whatsapp-text');

const formatDate = (value) => value.split('-').reverse().join('/');
const reportFont = 'PoupEazy Report';
const fontDirectory = path.join(__dirname, '../assets/fonts');
const colors = {
  background: '#f5f7fa',
  header: '#162838',
  text: '#1c2d3b',
  secondary: '#4c5c6a',
  income: '#08744f',
  incomeTrack: '#deeee6',
  expense: '#b42c43',
  expenseTrack: '#f8e5e8',
  balanceTrack: '#e7edf3',
};
let regularFont;
let boldFont;

async function renderReportImage(report) {
  // O Render pode executar a API em um ambiente sem fontes de sistema.
  regularFont ??= GlobalFonts.registerFromPath(path.join(fontDirectory, 'LiberationSans-Regular.ttf'), reportFont);
  boldFont ??= GlobalFonts.registerFromPath(path.join(fontDirectory, 'LiberationSans-Bold.ttf'), reportFont);
  if (!regularFont || !boldFont) throw new Error('Não foi possível carregar a fonte do relatório.');

  const categories = report.categorias ?? [];
  const income = Number(report.receitas);
  const expenses = Number(report.gastos);
  const scale = Math.max(income, expenses) || 1;
  const width = 800;
  const height = categories.length ? 490 + categories.length * 72 : 552;
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

  function bar(x, y, w, h, share, track, fill) {
    rectangle(x, y, w, h, track);
    if (share > 0) {
      rectangle(x, y, Math.min(w, Math.max(2, Math.round(w * share))), h, fill);
    }
  }

  rectangle(0, 0, width, height, colors.background);
  rectangle(0, 0, width, 148, colors.header);
  label('PoupEazy', 40, 42, 22, '#b8d8d3', true);
  label(report.title, 40, 92, 40, '#ffffff', true);
  const interval = report.start && report.start !== report.end
    ? `${formatDate(report.start)} a ${formatDate(report.end)}`
    : `${report.start ? '' : 'Até '}${formatDate(report.end)}`;
  label(interval, 40, 126, 22, '#d2dce4');

  const movements = [
    { name: 'Entradas', amount: income, ink: colors.income, track: colors.incomeTrack },
    { name: 'Saídas', amount: expenses, ink: colors.expense, track: colors.expenseTrack },
  ];
  const summary = [
    ...movements,
    {
      name: 'Saldo do período',
      amount: report.saldo,
      ink: report.saldo < 0 ? colors.expense : colors.text,
      track: colors.balanceTrack,
    },
  ];
  for (const [index, { name, amount, ink, track }] of summary.entries()) {
    const x = 40 + 248 * index;
    rectangle(x, 170, 224, 100, track);
    rectangle(x, 170, 224, 4, ink);
    label(name, x + 16, 207, 22, colors.text);
    label(currency.format(amount), x + 16, 245, 30, ink, true, 192);
  }

  label('Entradas × Saídas', 40, 322, 30, colors.text, true);
  for (const [index, { name, amount, ink, track }] of movements.entries()) {
    const y = 346 + index * 46;
    label(name, 40, y + 19, 24, colors.text, true);
    bar(162, y, 598, 24, amount / scale, track, ink);
  }

  rectangle(40, 443, 720, 1, colors.balanceTrack);
  label('Maiores saídas por categoria', 40, 487, 29, colors.text, true);
  if (!categories.length) {
    label('Nenhuma despesa confirmada no período.', 40, 527, 23, colors.secondary);
  }

  categories.forEach(({ nome, total }, index) => {
    const y = 524 + 72 * index;
    const share = expenses > 0 ? Number(total) / expenses : 0;
    const percent = share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
    label(nome.replace(/\s+/g, ' '), 40, y, 24, colors.text, true, 440);
    context.textAlign = 'right';
    label(`${currency.format(total)}  ·  ${percent}`, 760, y, 23, colors.secondary, false, 260);
    context.textAlign = 'left';
    bar(40, y + 13, 720, 12, share, colors.expenseTrack, colors.expense);
  });

  return canvas.encode('png');
}

module.exports = { renderReportImage };
