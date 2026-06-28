const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/categorias  -> categorias do sistema + as personalizadas do usuario
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM categoria
        WHERE sistema = TRUE OR id_usuario = $1
        ORDER BY nome ASC`,
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/categorias  { nome, tipo, icone? }
router.post('/', auth, async (req, res, next) => {
  const { nome, tipo, icone } = req.body || {};
  if (!nome || !tipo) {
    return next(new ApiError(400, 'nome e tipo sao obrigatorios.'));
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO categoria (id_usuario, nome, tipo, icone, sistema)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING *`,
      [req.userId, nome, tipo, icone ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/categorias/:id  (apenas categorias personalizadas do usuario)
router.patch('/:id', auth, async (req, res, next) => {
  const { nome, tipo, icone } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE categoria
         SET nome = COALESCE($1, nome),
             tipo = COALESCE($2, tipo),
             icone = COALESCE($3, icone)
       WHERE id = $4 AND id_usuario = $5 AND sistema = FALSE
       RETURNING *`,
      [nome ?? null, tipo ?? null, icone ?? null, req.params.id, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Categoria nao encontrada ou protegida.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/categorias/:id  (o trigger no banco impede deletar categoria do sistema)
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM categoria WHERE id = $1 AND id_usuario = $2 AND sistema = FALSE',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Categoria nao encontrada ou protegida.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
