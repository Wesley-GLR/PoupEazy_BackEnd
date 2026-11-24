const { ApiError } = require('../middleware/errorHandler');
const {
  hasOwn,
  validateDateOnly,
  validateEnum,
  validateInteger,
  validatePositiveMoney,
  validateString,
  validateUuid,
} = require('../utils/validation');

const TRANSACTION_TYPES = ['despesa', 'receita'];
const TRANSACTION_ORIGINS = ['manual', 'open_finance', 'chatbot'];
const TRANSACTION_STATUSES = ['pendente', 'confirmada', 'cancelada'];
const MUTABLE_FIELDS = [
  'id_orcamento', 'id_categoria', 'id_metas', 'valor', 'data_transacao',
  'descricao', 'tipo', 'origem', 'status', 'nlp_metadata',
];

function validateMetadata(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'nlp_metadata deve ser um objeto JSON ou null.');
  }
  return value;
}

function normalizeTransactionBody(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'O corpo da requisicao deve ser um objeto JSON.');
  }
  if (partial && !MUTABLE_FIELDS.some((field) => hasOwn(body, field))) {
    throw new ApiError(400, 'Informe ao menos um campo para atualizar.');
  }
  if (!partial) {
    const required = ['id_orcamento', 'id_categoria', 'valor', 'data_transacao', 'descricao', 'tipo'];
    const missing = required.filter((field) => !hasOwn(body, field) || body[field] == null || body[field] === '');
    if (missing.length > 0) {
      throw new ApiError(400, `${missing.join(', ')} sao obrigatorios.`);
    }
  }

  const normalized = {};
  if (hasOwn(body, 'id_orcamento')) normalized.id_orcamento = validateUuid(body.id_orcamento, 'id_orcamento');
  if (hasOwn(body, 'id_categoria')) normalized.id_categoria = validateUuid(body.id_categoria, 'id_categoria');
  if (hasOwn(body, 'id_metas')) {
    normalized.id_metas = body.id_metas == null ? null : validateUuid(body.id_metas, 'id_metas');
  }
  if (hasOwn(body, 'valor')) normalized.valor = validatePositiveMoney(body.valor, 'valor');
  if (hasOwn(body, 'data_transacao')) normalized.data_transacao = validateDateOnly(body.data_transacao, 'data_transacao');
  if (hasOwn(body, 'descricao')) normalized.descricao = validateString(body.descricao, 'descricao', { max: 255 });
  if (hasOwn(body, 'tipo')) normalized.tipo = validateEnum(body.tipo, TRANSACTION_TYPES, 'tipo');
  if (hasOwn(body, 'origem')) {
    if (body.origem == null && partial) throw new ApiError(422, 'origem nao pode ser null.');
    normalized.origem = body.origem == null
      ? 'manual'
      : validateEnum(body.origem, TRANSACTION_ORIGINS, 'origem');
  }
  if (hasOwn(body, 'status')) {
    if (body.status == null && partial) throw new ApiError(422, 'status nao pode ser null.');
    normalized.status = body.status == null
      ? 'confirmada'
      : validateEnum(body.status, TRANSACTION_STATUSES, 'status');
  }
  if (hasOwn(body, 'nlp_metadata')) normalized.nlp_metadata = validateMetadata(body.nlp_metadata);
  if (hasOwn(body, 'id_externo')) {
    normalized.id_externo = body.id_externo == null
      ? null
      : validateString(body.id_externo, 'id_externo', { max: 255 });
  }

  if (!partial) {
    normalized.id_metas ??= null;
    normalized.origem ??= 'manual';
    normalized.status ??= 'confirmada';
    normalized.nlp_metadata ??= null;
    normalized.id_externo ??= null;
  }
  return normalized;
}

async function validateTransactionReferences(queryable, userId, transaction, options = {}) {
  const { requireActiveMeta = true, enforceBudgetDate = true } = options;
  validateUuid(userId, 'usuario');

  const { rows: budgetRows } = await queryable.query(
    'SELECT id, mes, ano FROM orcamento WHERE id = $1 AND id_usuario = $2',
    [transaction.id_orcamento, userId]
  );
  const budget = budgetRows[0];
  if (!budget) throw new ApiError(403, 'Orcamento nao pertence ao usuario.', 'BUDGET_FORBIDDEN');

  const { rows: categoryRows } = await queryable.query(
    `SELECT id, tipo FROM categoria
      WHERE id = $1 AND (sistema = TRUE OR id_usuario = $2)`,
    [transaction.id_categoria, userId]
  );
  const category = categoryRows[0];
  if (!category) {
    throw new ApiError(403, 'Categoria nao esta disponivel para o usuario.', 'CATEGORY_FORBIDDEN');
  }

  const expectsRevenue = transaction.tipo === 'receita';
  const isRevenueCategory = category.tipo === 'receita';
  if (expectsRevenue !== isRevenueCategory) {
    throw new ApiError(
      422,
      expectsRevenue
        ? 'Uma receita deve usar uma categoria de receita.'
        : 'Uma despesa deve usar uma categoria de despesa.',
      'CATEGORY_TYPE_MISMATCH'
    );
  }

  if (enforceBudgetDate) {
    const [year, month] = transaction.data_transacao.split('-').map(Number);
    if (Number(budget.ano) !== year || Number(budget.mes) !== month) {
      throw new ApiError(
        422,
        'O orcamento deve corresponder ao mes e ano de data_transacao.',
        'BUDGET_DATE_MISMATCH'
      );
    }
  }

  if (transaction.id_metas) {
    const { rows: goalRows } = await queryable.query(
      'SELECT id, status FROM metas WHERE id = $1 AND id_usuario = $2',
      [transaction.id_metas, userId]
    );
    const goal = goalRows[0];
    if (!goal) throw new ApiError(403, 'Meta nao pertence ao usuario.', 'GOAL_FORBIDDEN');
    if (requireActiveMeta && goal.status !== 'ativa') {
      throw new ApiError(422, 'Apenas metas ativas aceitam novas movimentacoes.', 'GOAL_NOT_ACTIVE');
    }
  }
  return { budget, category };
}

async function createTransaction(queryable, userId, body) {
  const transaction = normalizeTransactionBody(body);
  await validateTransactionReferences(queryable, userId, transaction);

  const { rows } = await queryable.query(
    `INSERT INTO despesas
       (id_orcamento, id_categoria, id_metas, valor, data_transacao, descricao,
        tipo, origem, status, nlp_metadata, id_externo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (id_orcamento, id_externo) DO NOTHING
     RETURNING *`,
    [
      transaction.id_orcamento, transaction.id_categoria, transaction.id_metas,
      transaction.valor, transaction.data_transacao, transaction.descricao,
      transaction.tipo, transaction.origem, transaction.status,
      transaction.nlp_metadata, transaction.id_externo,
    ]
  );
  return rows[0];
}

function getSingleQueryValue(query, name) {
  const value = query[name];
  if (Array.isArray(value) || (value != null && typeof value !== 'string')) {
    throw new ApiError(400, `${name} deve ser informado uma unica vez.`);
  }
  return value;
}

function buildExpensesListQuery(userId, rawQuery = {}) {
  validateUuid(userId, 'usuario');
  const conditions = ['o.id_usuario = $1'];
  const values = [userId];
  const add = (clause, value) => {
    values.push(value);
    conditions.push(clause.replace('?', `$${values.length}`));
  };

  const q = getSingleQueryValue(rawQuery, 'q');
  if (q != null && q.trim() !== '') add('d.descricao ILIKE ?', `%${validateString(q, 'q', { max: 100 })}%`);

  for (const [field, allowed] of [
    ['tipo', TRANSACTION_TYPES], ['origem', TRANSACTION_ORIGINS], ['status', TRANSACTION_STATUSES],
  ]) {
    const value = getSingleQueryValue(rawQuery, field);
    if (value != null && value !== '') add(`d.${field} = ?`, validateEnum(value, allowed, field));
  }

  for (const field of ['id_categoria', 'id_orcamento', 'id_metas']) {
    const value = getSingleQueryValue(rawQuery, field);
    if (value != null && value !== '') add(`d.${field} = ?`, validateUuid(value, field));
  }

  const dataInicio = getSingleQueryValue(rawQuery, 'data_inicio');
  const dataFim = getSingleQueryValue(rawQuery, 'data_fim');
  if (dataInicio) add('d.data_transacao >= ?', validateDateOnly(dataInicio, 'data_inicio'));
  if (dataFim) add('d.data_transacao <= ?', validateDateOnly(dataFim, 'data_fim'));
  if (dataInicio && dataFim && dataInicio > dataFim) {
    throw new ApiError(422, 'data_inicio nao pode ser posterior a data_fim.');
  }

  const pageValue = getSingleQueryValue(rawQuery, 'page');
  const limitValue = getSingleQueryValue(rawQuery, 'limit');
  const paginated = pageValue != null || limitValue != null;
  const page = pageValue == null ? 1 : validateInteger(pageValue, 'page', { min: 1, max: 1000000 });
  const limit = limitValue == null ? 50 : validateInteger(limitValue, 'limit', { min: 1, max: 100 });
  const where = conditions.join('\n          AND ');
  const baseFrom = `FROM despesas d
       JOIN categoria c ON c.id = d.id_categoria
       JOIN orcamento o ON o.id = d.id_orcamento
      WHERE ${where}`;
  const selectValues = [...values];
  let paginationSql = '';
  if (paginated) {
    selectValues.push(limit, (page - 1) * limit);
    paginationSql = `\n      LIMIT $${selectValues.length - 1} OFFSET $${selectValues.length}`;
  }

  return {
    paginated, page, limit, values, selectValues,
    countSql: `SELECT COUNT(*)::int AS total ${baseFrom}`,
    selectSql: `SELECT d.*, row_to_json(c.*) AS categoria
      ${baseFrom}
      ORDER BY d.data_transacao DESC, d.criado_em DESC${paginationSql}`,
  };
}

module.exports = {
  MUTABLE_FIELDS,
  TRANSACTION_ORIGINS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  buildExpensesListQuery,
  createTransaction,
  normalizeTransactionBody,
  validateTransactionReferences,
};
