const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const {
  hasOwn,
  validateInteger,
  validateNonNegativeMoney,
  validateUuid,
} = require('../utils/validation');

const router = express.Router();

function normalizeBudget(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'O corpo da requisicao deve ser um objeto JSON.');
  }
  if (!partial && (!hasOwn(body, 'mes') || !hasOwn(body, 'ano'))) {
    throw new ApiError(400, 'mes e ano sao obrigatorios.');
  }
  if (partial && !['mes', 'ano', 'valor_planejado'].some((field) => hasOwn(body, field))) {
    throw new ApiError(400, 'Informe ao menos um campo para atualizar.');
  }
  const result = {};
  if (hasOwn(body, 'mes')) result.mes = validateInteger(body.mes, 'mes', { min: 1, max: 12 });
  if (hasOwn(body, 'ano')) result.ano = validateInteger(body.ano, 'ano', { min: 2000, max: 2100 });
  if (hasOwn(body, 'valor_planejado')) {
    result.valor_planejado = validateNonNegativeMoney(body.valor_planejado, 'valor_planejado');
  }
  return result;
}

router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM orcamento WHERE id_usuario = $1 ORDER BY ano DESC, mes DESC',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const budget = normalizeBudget(req.body);
    const { rows } = await db.query(
      `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.userId, budget.mes, budget.ano, budget.valor_planejado ?? 0]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post('/get-or-create', auth, async (req, res, next) => {
  try {
    const budget = normalizeBudget(req.body);
    const { rows } = await db.query(
      `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_usuario, mes, ano)
       DO UPDATE SET id_usuario = EXCLUDED.id_usuario
       RETURNING *`,
      [req.userId, budget.mes, budget.ano, budget.valor_planejado ?? 0]
    );
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', auth, async (req, res, next) => {
  try {
    const id = validateUuid(req.params.id, 'id');
    const patch = normalizeBudget(req.body, true);
    const { rows } = await db.query(
      `UPDATE orcamento
          SET valor_planejado = CASE WHEN $1 THEN $2 ELSE valor_planejado END,
              mes = CASE WHEN $3 THEN $4 ELSE mes END,
              ano = CASE WHEN $5 THEN $6 ELSE ano END
        WHERE id = $7 AND id_usuario = $8
        RETURNING *`,
      [
        hasOwn(patch, 'valor_planejado'), patch.valor_planejado ?? null,
        hasOwn(patch, 'mes'), patch.mes ?? null,
        hasOwn(patch, 'ano'), patch.ano ?? null,
        id, req.userId,
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Orcamento nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.normalizeBudget = normalizeBudget;
