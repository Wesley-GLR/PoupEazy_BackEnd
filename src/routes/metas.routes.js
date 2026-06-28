const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/metas
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM metas WHERE id_usuario = $1 ORDER BY data_limite ASC',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/metas
router.post('/', auth, async (req, res, next) => {
  const { nome, descricao, valor_objetivo, data_limite, status } = req.body || {};
  if (!nome || !data_limite) {
    return next(new ApiError(400, 'nome e data_limite sao obrigatorios.'));
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO metas (id_usuario, nome, descricao, valor_objetivo, data_limite, status)
       VALUES ($1, $2, $3, COALESCE($4, 0), $5, COALESCE($6, 'ativa'))
       RETURNING *`,
      [req.userId, nome, descricao ?? null, valor_objetivo ?? null, data_limite, status ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/metas/:id
router.patch('/:id', auth, async (req, res, next) => {
  const { nome, descricao, valor_objetivo, data_limite, status } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE metas
         SET nome = COALESCE($1, nome),
             descricao = COALESCE($2, descricao),
             valor_objetivo = COALESCE($3, valor_objetivo),
             data_limite = COALESCE($4, data_limite),
             status = COALESCE($5, status)
       WHERE id = $6 AND id_usuario = $7
       RETURNING *`,
      [nome ?? null, descricao ?? null, valor_objetivo ?? null, data_limite ?? null, status ?? null, req.params.id, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Meta nao encontrada.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/metas/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM metas WHERE id = $1 AND id_usuario = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Meta nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
