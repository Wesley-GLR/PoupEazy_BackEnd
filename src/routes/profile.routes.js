const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/profile
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1', [req.userId]);
    if (!rows[0]) throw new ApiError(404, 'Profile nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/profile  { nome?, telefone? }
router.patch('/', auth, async (req, res, next) => {
  const { nome, telefone } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE profiles
         SET nome = COALESCE($1, nome),
             telefone = COALESCE($2, telefone)
       WHERE id = $3
       RETURNING *`,
      [nome ?? null, telefone ?? null, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Profile nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
