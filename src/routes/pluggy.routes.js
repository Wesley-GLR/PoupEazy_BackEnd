const express = require('express');
const db = require('../db');
const config = require('../config');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const {
  buildConnectTokenOptions,
  fetchAllItemTransactions,
  getOwnedIntegrationByItem,
  getPluggyClient,
  syncIntegration,
} = require('../services/pluggy.service');
const { validateUuid } = require('../utils/validation');

const router = express.Router();

function upstreamError(err, next, message) {
  if (err instanceof ApiError) return next(err);
  // eslint-disable-next-line no-console
  console.error('[pluggy] Erro no provedor:', err);
  return next(new ApiError(502, message, 'PLUGGY_UPSTREAM_ERROR'));
}

router.get('/token', auth, async (req, res, next) => {
  try {
    const client = getPluggyClient();
    const data = await client.createConnectToken(undefined, buildConnectTokenOptions(req.userId));
    return res.json({ connectToken: data.accessToken });
  } catch (err) {
    return upstreamError(err, next, 'Nao foi possivel iniciar a conexao bancaria.');
  }
});

// Contrato legado mantido para o frontend web, agora com verificacao de propriedade
// e coleta de todas as contas/paginas. O app mobile usa o endpoint /sync abaixo.
router.get('/transactions/:itemId', auth, async (req, res, next) => {
  try {
    await getOwnedIntegrationByItem(db, req.userId, req.params.itemId);
    const result = await fetchAllItemTransactions(
      getPluggyClient(),
      req.params.itemId,
      config.pluggy.syncMaxTransactions
    );
    return res.json({ transactions: result.transactions });
  } catch (err) {
    return upstreamError(err, next, 'Nao foi possivel consultar o extrato bancario.');
  }
});

// Importa todo o extrato no servidor. O itemId nunca volta para o app e a gravacao
// ocorre em uma transacao SQL, com orcamento do mes correto e deduplicacao.
router.post('/sync/:integrationId', auth, async (req, res, next) => {
  try {
    const integrationId = validateUuid(req.params.integrationId, 'integrationId');
    const result = await syncIntegration({
      database: db,
      client: getPluggyClient(),
      userId: req.userId,
      integrationId,
      maxTransactions: config.pluggy.syncMaxTransactions,
    });
    return res.json(result);
  } catch (err) {
    return upstreamError(err, next, 'Nao foi possivel sincronizar as transacoes bancarias.');
  }
});

module.exports = router;
