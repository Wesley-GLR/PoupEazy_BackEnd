const express = require('express');
const { PluggyClient } = require('pluggy-sdk');
const config = require('../config');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// Inicializa o cliente Pluggy uma unica vez (lazy), reaproveitando o backend antigo.
let pluggyClient = null;
function getPluggyClient() {
  if (!config.pluggy.clientId || !config.pluggy.clientSecret) {
    throw new ApiError(500, 'Credenciais da Pluggy nao configuradas (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).');
  }
  if (!pluggyClient) {
    pluggyClient = new PluggyClient({
      clientId: config.pluggy.clientId,
      clientSecret: config.pluggy.clientSecret,
    });
  }
  return pluggyClient;
}

// GET /api/pluggy/token
// O frontend pede permissao para abrir o Widget da Pluggy.
router.get('/token', auth, async (req, res, next) => {
  try {
    const client = getPluggyClient();
    const data = await client.createConnectToken();
    return res.json({ connectToken: data.accessToken });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    // eslint-disable-next-line no-console
    console.error('[pluggy] Erro ao gerar connect token:', err);
    return next(new ApiError(500, 'Erro ao gerar token da Pluggy.'));
  }
});

// GET /api/pluggy/transactions/:itemId
// Puxa o extrato da conta conectada e retorna transacoes ja normalizadas.
router.get('/transactions/:itemId', auth, async (req, res, next) => {
  try {
    const client = getPluggyClient();
    const { itemId } = req.params;

    const accounts = await client.fetchAccounts(itemId);
    if (accounts.results.length === 0) {
      return res.json({ transactions: [] });
    }

    const accountId = accounts.results[0].id;
    const transactions = await client.fetchTransactions(accountId);

    const transacoesLimpas = transactions.results.map((tx) => ({
      descricao: tx.description,
      valor: Math.abs(tx.amount),
      tipo: tx.amount < 0 ? 'despesa' : 'receita',
      data: new Date(tx.date).toISOString().split('T')[0],
    }));

    return res.json({ transactions: transacoesLimpas });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    // eslint-disable-next-line no-console
    console.error('[pluggy] Erro ao buscar extrato:', err);
    return next(new ApiError(500, 'Erro ao buscar extrato.'));
  }
});

module.exports = router;
