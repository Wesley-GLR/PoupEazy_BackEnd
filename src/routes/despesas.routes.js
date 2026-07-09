const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// Confere se o orcamento informado pertence ao usuario logado.
async function orcamentoDoUsuario(idOrcamento, userId) {
  const { rows } = await db.query(
    'SELECT 1 FROM orcamento WHERE id = $1 AND id_usuario = $2',
    [idOrcamento, userId]
  );
  return rows.length > 0;
}

// GET /api/despesas
// Espelha o hook useTransactions: despesas dos orcamentos do usuario,
// ja com a categoria aninhada (campo "categoria") e ordenadas por data desc.
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT d.*, row_to_json(c.*) AS categoria
         FROM despesas d
         JOIN categoria c ON c.id = d.id_categoria
         JOIN orcamento o ON o.id = d.id_orcamento
        WHERE o.id_usuario = $1
        ORDER BY d.data_transacao DESC, d.criado_em DESC`,
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/despesas
router.post('/', auth, async (req, res, next) => {
  const {
    id_orcamento,
    id_categoria,
    id_metas,
    valor,
    data_transacao,
    descricao,
    tipo,
    origem,
    status,
    nlp_metadata,
    id_externo,          
  } = req.body || {};

  if (!id_orcamento || !id_categoria || !valor || !data_transacao || !descricao || !tipo) {
    return next(
      new ApiError(400, 'id_orcamento, id_categoria, valor, data_transacao, descricao e tipo sao obrigatorios.')
    );
  }

  try {
    if (!(await orcamentoDoUsuario(id_orcamento, req.userId))) {
      throw new ApiError(403, 'Orcamento nao pertence ao usuario.');
    }

    const { rows } = await db.query(
      `INSERT INTO despesas
         (id_orcamento, id_categoria, id_metas, valor, data_transacao, descricao, tipo, origem, status, nlp_metadata, id_externo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'manual'), COALESCE($9, 'confirmada'), $10, $11)
      ON CONFLICT (id_orcamento, id_externo) DO NOTHING
       RETURNING *`,
      [
        id_orcamento, id_categoria, id_metas ?? null, valor, data_transacao,
        descricao, tipo, origem ?? null, status ?? null, nlp_metadata ?? null,
        id_externo ?? null,
      ]
    );
    if (!rows[0]) {
      return res.status(200).json({ duplicado: true });
    }
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/despesas/:id
router.patch('/:id', auth, async (req, res, next) => {
  const {
    id_orcamento,
    id_categoria,
    id_metas,
    valor,
    data_transacao,
    descricao,
    tipo,
    origem,
    status,
    nlp_metadata,
  } = req.body || {};

  try {
    // Se trocar o orcamento, valida que o novo tambem pertence ao usuario.
    if (id_orcamento && !(await orcamentoDoUsuario(id_orcamento, req.userId))) {
      throw new ApiError(403, 'Orcamento nao pertence ao usuario.');
    }

    const { rows } = await db.query(
      `UPDATE despesas
         SET id_orcamento = COALESCE($1, id_orcamento),
             id_categoria = COALESCE($2, id_categoria),
             id_metas = COALESCE($3, id_metas),
             valor = COALESCE($4, valor),
             data_transacao = COALESCE($5, data_transacao),
             descricao = COALESCE($6, descricao),
             tipo = COALESCE($7, tipo),
             origem = COALESCE($8, origem),
             status = COALESCE($9, status),
             nlp_metadata = COALESCE($10, nlp_metadata)
       WHERE id = $11
         AND id_orcamento IN (SELECT id FROM orcamento WHERE id_usuario = $12)
       RETURNING *`,
      [
        id_orcamento ?? null,
        id_categoria ?? null,
        id_metas ?? null,
        valor ?? null,
        data_transacao ?? null,
        descricao ?? null,
        tipo ?? null,
        origem ?? null,
        status ?? null,
        nlp_metadata ?? null,
        req.params.id,
        req.userId,
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Transacao nao encontrada.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/despesas/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
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
