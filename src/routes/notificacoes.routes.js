const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/notificacoes
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM notificacoes WHERE id_usuario = $1 ORDER BY criado_em DESC',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/notificacoes/:id  (marcar como lida/nao lida)
router.patch('/:id', auth, async (req, res, next) => {
  const { lida } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE notificacoes
         SET lida = COALESCE($1, lida)
       WHERE id = $2 AND id_usuario = $3
       RETURNING *`,
      [typeof lida === 'boolean' ? lida : null, req.params.id, req.userId]
    );
    if (!rows[0]) throw new ApiError(404, 'Notificacao nao encontrada.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/notificacoes/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM notificacoes WHERE id = $1 AND id_usuario = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Notificacao nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
