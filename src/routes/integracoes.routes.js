const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { getPluggyClient, publicIntegration } = require('../services/pluggy.service');
const { validateString, validateUuid } = require('../utils/validation');

const router = express.Router();

router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT id, instituicao, expira_em, ultimo_uso, ativo, criado_em
         FROM open_finance_tokens
        WHERE id_usuario = $1 AND ativo = TRUE
        ORDER BY criado_em DESC`,
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const requestedInstitution = validateString(req.body?.instituicao, 'instituicao', { max: 100 });
    const itemId = validateString(req.body?.itemId, 'itemId', { max: 255 });

    // O item precisa ter sido criado por um Connect Token associado ao usuario.
    // Isso impede que um itemId obtido fora desta conta seja cadastrado e sincronizado.
    let item;
    try {
      item = await getPluggyClient().fetchItem(itemId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[pluggy] Falha ao validar item conectado:', err);
      throw new ApiError(502, 'Nao foi possivel validar a conexao na Pluggy.', 'PLUGGY_ITEM_VALIDATION_FAILED');
    }
    if (!item || item.clientUserId !== req.userId) {
      throw new ApiError(403, 'A conexao bancaria nao pertence ao usuario.', 'PLUGGY_ITEM_FORBIDDEN');
    }

    const institution = validateString(item.connector?.name || requestedInstitution, 'instituicao', { max: 100 });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const { rows } = await db.query(
      `INSERT INTO open_finance_tokens
         (id_usuario, instituicao, access_token_enc, expira_em, ativo)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id_usuario, instituicao)
       DO UPDATE SET access_token_enc = EXCLUDED.access_token_enc,
                     expira_em = EXCLUDED.expira_em,
                     ativo = TRUE
       RETURNING id, instituicao, expira_em, ultimo_uso, ativo, criado_em`,
      [req.userId, institution, itemId, expiresAt]
    );
    return res.status(201).json(publicIntegration(rows[0]));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const id = validateUuid(req.params.id, 'id');
    const { rowCount } = await db.query(
      'UPDATE open_finance_tokens SET ativo = FALSE WHERE id = $1 AND id_usuario = $2 AND ativo = TRUE',
      [id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Conexao nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
