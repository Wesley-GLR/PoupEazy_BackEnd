const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/relatorios/resumo-mensal  (view vw_resumo_mensal)
router.get('/resumo-mensal', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vw_resumo_mensal WHERE id_usuario = $1 ORDER BY ano DESC, mes DESC',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/relatorios/progresso-metas  (view vw_progresso_metas)
router.get('/progresso-metas', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vw_progresso_metas WHERE id_usuario = $1',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// GET /api/relatorios/historico  (view vw_historico_comparativo)
router.get('/historico', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM vw_historico_comparativo WHERE id_usuario = $1',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
