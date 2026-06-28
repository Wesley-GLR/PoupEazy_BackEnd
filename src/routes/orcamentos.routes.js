const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/orcamentos
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

// POST /api/orcamentos
router.post('/', auth, async (req, res, next) => {
  const { mes, ano, valor_planejado } = req.body || {};
  if (mes == null || ano == null) {
    return next(new ApiError(400, 'mes e ano sao obrigatorios.'));
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       RETURNING *`,
      [req.userId, mes, ano, valor_planejado ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// POST /api/orcamentos/get-or-create  { mes, ano }
// Espelha o getOrCreateBudget do frontend: faz upsert pela chave (usuario, mes, ano).
router.post('/get-or-create', auth, async (req, res, next) => {
  const { mes, ano, valor_planejado } = req.body || {};
  if (mes == null || ano == null) {
    return next(new ApiError(400, 'mes e ano sao obrigatorios.'));
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
       VALUES ($1, $2, $3, COALESCE($4, 0))
       ON CONFLICT (id_usuario, mes, ano)
       DO UPDATE SET id_usuario = EXCLUDED.id_usuario
       RETURNING *`,
      [req.userId, mes, ano, valor_planejado ?? null]
    );
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/orcamentos/:id
router.patch('/:id', auth, async (req, res, next) => {
  const { valor_planejado, mes, ano } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE orcamento
         SET valor_planejado = COALESCE($1, valor_planejado),
             mes = COALESCE($2, mes),
             ano = COALESCE($3, ano)
       WHERE id = $4 AND id_usuario = $5
       RETURNING *`,
      [valor_planejado ?? null, mes ?? null, ano ?? null, req.params.id, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Orcamento nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
