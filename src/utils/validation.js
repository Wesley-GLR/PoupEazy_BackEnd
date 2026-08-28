const { ApiError } = require('../middleware/errorHandler');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email || email.length > 255 || !EMAIL_PATTERN.test(email)) {
    throw new ApiError(400, 'Informe um e-mail valido.');
  }
  return email;
}

function validateUuid(value, fieldName) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new ApiError(400, `${fieldName} deve ser um UUID valido.`);
  }
  return value;
}

function validateDateOnly(value, fieldName = 'data') {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${fieldName} deve usar o formato YYYY-MM-DD.`);
  }
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new ApiError(400, `${fieldName} deve usar o formato YYYY-MM-DD.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ApiError(400, `${fieldName} nao e uma data valida.`);
  }
  return value;
}

function validatePositiveMoney(value, fieldName = 'valor') {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number <= 0) {
    throw new ApiError(422, `${fieldName} deve ser maior que zero.`);
  }
  if (number > 9999999999.99) {
    throw new ApiError(422, `${fieldName} excede o limite permitido.`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function validateNonNegativeMoney(value, fieldName = 'valor') {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) {
    throw new ApiError(422, `${fieldName} nao pode ser negativo.`);
  }
  if (number > 9999999999.99) {
    throw new ApiError(422, `${fieldName} excede o limite permitido.`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function validateEnum(value, allowed, fieldName) {
  if (!allowed.includes(value)) {
    throw new ApiError(422, `${fieldName} deve ser um de: ${allowed.join(', ')}.`);
  }
  return value;
}

function validateString(value, fieldName, { max = 255, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${fieldName} deve ser texto.`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new ApiError(422, `${fieldName} nao pode ficar vazio.`);
  }
  if (normalized.length > max) {
    throw new ApiError(422, `${fieldName} deve ter no maximo ${max} caracteres.`);
  }
  return normalized;
}

function validateInteger(value, fieldName, { min, max } = {}) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(number)) {
    throw new ApiError(400, `${fieldName} deve ser um numero inteiro.`);
  }
  if (min != null && number < min) {
    throw new ApiError(422, `${fieldName} deve ser no minimo ${min}.`);
  }
  if (max != null && number > max) {
    throw new ApiError(422, `${fieldName} deve ser no maximo ${max}.`);
  }
  return number;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

module.exports = {
  hasOwn,
  normalizeEmail,
  validateDateOnly,
  validateEmail,
  validateEnum,
  validateInteger,
  validateNonNegativeMoney,
  validatePositiveMoney,
  validateString,
  validateUuid,
};
