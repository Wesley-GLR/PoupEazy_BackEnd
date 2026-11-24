const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { hasOwn, validateUuid } = require('../utils/validation');
const {
  buildExpensesListQuery,
  createTransaction,
  normalizeTransactionBody,
  validateTransactionReferences,
} = require('../services/despesas.service');

const router = express.Router();

// Sem page/limit, preserva o contrato historico e retorna um array. Quando page
// ou limit e informado, retorna { data, pagination } para o app mobile.
router.get('/', auth, async (req, res, next) => {
  try {
    const query = buildExpensesListQuery(req.userId, req.query);
    const { rows } = await db.query(query.selectSql, query.selectValues);
    if (!query.paginated) return res.json(rows);

    const { rows: countRows } = await db.query(query.countSql, query.values);
    const total = Number(countRows[0]?.total || 0);
    res.set('X-Total-Count', String(total));
    return res.json({
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const transaction = await createTransaction(db, req.userId, req.body);
    if (!transaction) return res.status(200).json({ duplicado: true });
    return res.status(201).json(transaction);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', auth, async (req, res, next) => {
  try {
    validateUuid(req.params.id, 'id');
    const patch = normalizeTransactionBody(req.body, { partial: true });

    const { rows: existingRows } = await db.query(
      `SELECT d.*
         FROM despesas d
         JOIN orcamento o ON o.id = d.id_orcamento
        WHERE d.id = $1 AND o.id_usuario = $2`,
      [req.params.id, req.userId]
    );
    const existing = existingRows[0];
    if (!existing) throw new ApiError(404, 'Transacao nao encontrada.');

    const effective = { ...existing, ...patch };
    const changesGoalBalance = ['id_metas', 'valor', 'tipo', 'status'].some((field) => hasOwn(patch, field));
    await validateTransactionReferences(db, req.userId, effective, {
      requireActiveMeta: changesGoalBalance,
    });

    const present = (field) => hasOwn(patch, field);
    const { rows } = await db.query(
      `UPDATE despesas
          SET id_orcamento = CASE WHEN $1 THEN $2 ELSE id_orcamento END,
              id_categoria = CASE WHEN $3 THEN $4 ELSE id_categoria END,
              id_metas = CASE WHEN $5 THEN $6 ELSE id_metas END,
              valor = CASE WHEN $7 THEN $8 ELSE valor END,
              data_transacao = CASE WHEN $9 THEN $10 ELSE data_transacao END,
              descricao = CASE WHEN $11 THEN $12 ELSE descricao END,
              tipo = CASE WHEN $13 THEN $14 ELSE tipo END,
              origem = CASE WHEN $15 THEN $16 ELSE origem END,
              status = CASE WHEN $17 THEN $18 ELSE status END,
              nlp_metadata = CASE WHEN $19 THEN $20 ELSE nlp_metadata END
        WHERE id = $21
          AND id_orcamento IN (SELECT id FROM orcamento WHERE id_usuario = $22)
        RETURNING *`,
      [
        present('id_orcamento'), patch.id_orcamento ?? null,
        present('id_categoria'), patch.id_categoria ?? null,
        present('id_metas'), patch.id_metas ?? null,
        present('valor'), patch.valor ?? null,
        present('data_transacao'), patch.data_transacao ?? null,
        present('descricao'), patch.descricao ?? null,
        present('tipo'), patch.tipo ?? null,
        present('origem'), patch.origem ?? null,
        present('status'), patch.status ?? null,
        present('nlp_metadata'), patch.nlp_metadata ?? null,
        req.params.id, req.userId,
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Transacao nao encontrada.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    validateUuid(req.params.id, 'id');
    const { rowCount } = await db.query(
      `DELETE FROM despesas
        WHERE id = $1
          AND id_orcamento IN (SELECT id FROM orcamento WHERE id_usuario = $2)`,
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Transacao nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
