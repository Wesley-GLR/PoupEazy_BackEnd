const { validatePositiveMoney } = require('../utils/validation');

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const FORMAT = 'Envie a descrição e o valor, por exemplo: cabelo 35, 35 cabelo ou café R$ 12,50. Aceito vírgula ou ponto nos centavos.';
const HELP = FORMAT
  + '\nVou pedir sua confirmação antes de registrar. Para consultar, envie relatório diário, semanal, mensal ou total.';
const LINK_HELP = 'Para vincular sua conta, entre no PoupEazy, abra Transações → Registrar via WhatsApp e envie a mensagem de vínculo que o site preparar.';

function normalizeCommand(text) {
  return text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

const amount = String.raw`(R\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+(?:[.,]\d{1,2})?)(\s+rea(?:l|is))?`;
const amountAtStart = new RegExp(`^${amount} (.+)$`, 'iu');
const amountAtEnd = new RegExp(`^(.+?) ${amount}$`, 'iu');

function parseExpense(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  const start = amountAtStart.exec(clean);
  const end = amountAtEnd.exec(clean);
  const candidates = [];
  if (start) candidates.push({ description: start[4], value: start[2], explicit: Boolean(start[1] || start[3]) });
  if (end) candidates.push({ description: end[1], value: end[3], explicit: Boolean(end[2] || end[4]) });
  const explicit = candidates.filter((candidate) => candidate.explicit);
  const matches = explicit.length ? explicit : candidates;
  if (matches.length !== 1) return null;

  const { description, value } = matches[0];
  if (description.length > 255 || !/\p{L}/u.test(description) || /[\p{Cc}\p{Cf}]/u.test(description)
    || /R\$/i.test(description) || /(?:^|\s)[+-]$/.test(description)) return null;

  const decimal = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
  try {
    return { description, value: validatePositiveMoney(decimal) };
  } catch (err) {
    if (err.status === 400 || err.status === 422) return null;
    throw err;
  }
}

const reportCommands = new Map([
  ['relatorio', 'semanal'],
  ['relatorio diario', 'diario'],
  ['relatorio de hoje', 'diario'],
  ['relatorio semanal', 'semanal'],
  ['relatorio da semana', 'semanal'],
  ['relatorio mensal', 'mensal'],
  ['relatorio do mes', 'mensal'],
  ['relatorio total', 'total'],
  ['relatorio de todo o periodo', 'total'],
]);

const periods = {
  diario: 'Hoje',
  semanal: 'Esta semana',
  mensal: 'Este mês',
  total: 'Todo o período',
};

function getReportRange(period, date) {
  const end = localDate.format(date);
  let start = end;
  if (period === 'mensal') start = `${end.slice(0, 7)}-01`;
  if (period === 'semanal') {
    const monday = new Date(`${end}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    start = monday.toISOString().slice(0, 10);
  }
  if (period === 'total') start = null;
  return { title: periods[period], start, end };
}

function describeExpense(expense) {
  return `“${expense.description}” — ${currency.format(expense.value)}`;
}

module.exports = { currency, localDate, FORMAT, HELP, LINK_HELP, normalizeCommand, parseExpense, reportCommands, getReportRange, describeExpense };
