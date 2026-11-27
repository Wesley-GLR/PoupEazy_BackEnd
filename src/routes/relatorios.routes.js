const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const config = require('../config');
const { createGmailService } = require('../services/gmail.service');
const { createReportEmailService } = require('../services/report-email.service');

function createRelatoriosRouter({ sendEmail } = {}) {
const router = express.Router();
const service = createReportEmailService({database:db,sendEmail:sendEmail || createGmailService(config.email).send,
  emailEnabled:typeof sendEmail === 'function' || config.email.enabled});

router.post('/email',auth,async (req,res,next) => {
  res.set('Cache-Control','no-store');
  try { return res.json(await service.sendReport(req.userId,req.body)); }
  catch (error) {
    if (error.retry_after_seconds) {
      res.set('Retry-After',String(error.retry_after_seconds));
      return res.status(error.status).json({error:error.message,code:error.code,retry_after_seconds:error.retry_after_seconds});
    }
    return next(error);
  }
});

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

return router;
}
module.exports = { createRelatoriosRouter };
