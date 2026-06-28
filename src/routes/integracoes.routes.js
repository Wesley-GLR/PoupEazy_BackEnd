const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// GET /api/integracoes  -> conexoes bancarias ativas do usuario
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM open_finance_tokens
        WHERE id_usuario = $1 AND ativo = TRUE
        ORDER BY criado_em DESC`,
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/integracoes  { instituicao, itemId }
// Espelha o connectBank: guarda o itemId da Pluggy em access_token_enc, expira em 30 dias.
// Usa upsert para reaproveitar/reativar a conexao com a mesma instituicao.
router.post('/', auth, async (req, res, next) => {
  const { instituicao, itemId } = req.body || {};
  if (!instituicao || !itemId) {
    return next(new ApiError(400, 'instituicao e itemId sao obrigatorios.'));
  }
  try {
    const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { rows } = await db.query(
      `INSERT INTO open_finance_tokens (id_usuario, instituicao, access_token_enc, expira_em, ativo)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id_usuario, instituicao)
       DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc,
                     expira_em = EXCLUDED.expira_em,
                     ativo = TRUE
       RETURNING *`,
      [req.userId, instituicao, itemId, expiraEm]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/integracoes/:id  -> desconecta (marca ativo=false), espelha disconnectBank
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const { rowCount } = await db.query(
      'UPDATE open_finance_tokens SET ativo = FALSE WHERE id = $1 AND id_usuario = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Conexao nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
