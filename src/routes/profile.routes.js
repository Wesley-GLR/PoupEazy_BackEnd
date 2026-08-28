const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { hasOwn, validateString } = require('../utils/validation');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM profiles WHERE id = $1', [req.userId]);
    if (!rows[0]) throw new ApiError(404, 'Profile nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/', auth, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!hasOwn(body, 'nome') && !hasOwn(body, 'telefone')) {
      throw new ApiError(400, 'Informe nome ou telefone para atualizar.');
    }
    const nome = hasOwn(body, 'nome')
      ? validateString(body.nome, 'nome', { max: 150 })
      : null;
    const telefone = hasOwn(body, 'telefone')
      ? body.telefone == null
        ? null
        : validateString(body.telefone, 'telefone', { max: 20, allowEmpty: true }) || null
      : null;
    const { rows } = await db.query(
      `UPDATE profiles
          SET nome = CASE WHEN $1 THEN $2 ELSE nome END,
              telefone = CASE WHEN $3 THEN $4 ELSE telefone END
        WHERE id = $5
        RETURNING *`,
      [hasOwn(body, 'nome'), nome, hasOwn(body, 'telefone'), telefone, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Profile nao encontrado.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
