const { PluggyClient } = require('pluggy-sdk');
const config = require('../config');
const { ApiError } = require('../middleware/errorHandler');
const { validateString, validateUuid } = require('../utils/validation');

let pluggyClient;

function getPluggyClient() {
  if (!config.pluggy.clientId || !config.pluggy.clientSecret) {
    throw new ApiError(503, 'Integracao Pluggy nao configurada.');
  }
  if (!pluggyClient) {
    pluggyClient = new PluggyClient({
      clientId: config.pluggy.clientId,
      clientSecret: config.pluggy.clientSecret,
    });
  }
  return pluggyClient;
}

function buildConnectTokenOptions(userId) {
  validateUuid(userId, 'usuario');
  return {
    clientUserId: userId,
    avoidDuplicates: true,
    ...(config.pluggy.oauthRedirectUri
      ? { oauthRedirectUri: config.pluggy.oauthRedirectUri }
      : {}),
  };
}

function publicIntegration(row) {
  if (!row) return null;
  return {
    id: row.id,
    instituicao: row.instituicao,
    expira_em: row.expira_em,
    ultimo_uso: row.ultimo_uso,
    ativo: row.ativo,
    criado_em: row.criado_em,
  };
}

function dateOnly(value) {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(502, 'A Pluggy retornou uma transacao com data invalida.');
  }
  return date.toISOString().slice(0, 10);
}

function normalizePluggyTransaction(transaction, account) {
  if (!transaction?.id) {
    throw new ApiError(502, 'A Pluggy retornou uma transacao sem identificador.');
  }
  const rawAmount = Number(transaction.amount);
  if (!Number.isFinite(rawAmount)) {
    throw new ApiError(502, 'A Pluggy retornou uma transacao com valor invalido.');
  }

  const type = transaction.type === 'DEBIT'
    ? 'despesa'
    : transaction.type === 'CREDIT'
      ? 'receita'
      : rawAmount < 0 ? 'despesa' : 'receita';
  const description = String(transaction.description || transaction.descriptionRaw || 'Transacao bancaria')
    .trim()
    .slice(0, 255) || 'Transacao bancaria';

  return {
    id_externo: String(transaction.id).slice(0, 255),
    descricao: description,
    valor: Math.round((Math.abs(rawAmount) + Number.EPSILON) * 100) / 100,
    tipo: type,
    data: dateOnly(transaction.date),
    status: transaction.status === 'PENDING' ? 'pendente' : 'confirmada',
    accountId: account.id,
    accountName: account.name || null,
    pluggyCategory: transaction.category || null,
  };
}

async function fetchAllItemTransactions(client, itemId, maxTransactions = 10000) {
  const accountsPage = await client.fetchAccounts(itemId);
  const accounts = accountsPage?.results || [];
  if (Number(accountsPage?.total || accounts.length) > accounts.length) {
    throw new ApiError(502, 'A versao atual do SDK nao retornou todas as contas da conexao.');
  }

  const byId = new Map();
  for (const account of accounts) {
    let transactions;
    if (typeof client.fetchAllTransactions === 'function') {
      transactions = await client.fetchAllTransactions(account.id);
    } else {
      transactions = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await client.fetchTransactions(account.id, { page, pageSize: 500 });
        transactions.push(...(response.results || []));
        totalPages = Number(response.totalPages || 1);
        page += 1;
      } while (page <= totalPages);
    }

    for (const transaction of transactions) {
      const normalized = normalizePluggyTransaction(transaction, account);
      if (normalized.valor === 0) continue;
      byId.set(normalized.id_externo, normalized);
      if (byId.size > maxTransactions) {
        throw new ApiError(422, `A sincronizacao excedeu o limite de ${maxTransactions} transacoes.`);
      }
    }
  }
  return { accounts, transactions: [...byId.values()] };
}

function folded(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function chooseCategory(categories, transaction) {
  const description = folded(transaction.descricao);
  let desired = transaction.tipo === 'receita' ? 'salario' : 'outros';
  if (transaction.tipo === 'despesa') {
    const rules = [
      ['transporte', ['uber', '99', 'posto', 'combustivel', 'metro', 'onibus']],
      ['alimentacao', ['ifood', 'mercado', 'supermercado', 'padaria', 'restaurante']],
      ['assinaturas', ['netflix', 'spotify', 'amazon prime', 'assinatura']],
      ['saude', ['farmacia', 'drogaria', 'academia', 'whey', 'creatina']],
      ['lazer', ['ingresso', 'cinema', 'clube', 'socio']],
      ['educacao', ['curso', 'faculdade', 'escola', 'livro', 'kaggle']],
      ['moradia', ['aluguel', 'condominio', 'energia', 'copasa', 'internet']],
    ];
    desired = rules.find(([, words]) => words.some((word) => description.includes(word)))?.[0] || desired;
  }

  const compatible = categories.filter((category) =>
    transaction.tipo === 'receita' ? category.tipo === 'receita' : category.tipo !== 'receita'
  );
  return compatible.find((category) => folded(category.nome) === desired) || compatible[0] || null;
}

async function getOwnedIntegrationByItem(database, userId, itemId) {
  validateUuid(userId, 'usuario');
  const normalizedItemId = validateString(itemId, 'itemId', { max: 255 });
  const { rows } = await database.query(
    `SELECT * FROM open_finance_tokens
      WHERE id_usuario = $1 AND access_token_enc = $2 AND ativo = TRUE`,
    [userId, normalizedItemId]
  );
  if (!rows[0]) {
    throw new ApiError(404, 'Conexao bancaria nao encontrada.', 'INTEGRATION_NOT_FOUND');
  }
  return rows[0];
}

async function syncIntegration({ database, client, userId, integrationId, maxTransactions }) {
  validateUuid(userId, 'usuario');
  validateUuid(integrationId, 'integrationId');

  const { rows: initialRows } = await database.query(
    `SELECT * FROM open_finance_tokens
      WHERE id = $1 AND id_usuario = $2 AND ativo = TRUE`,
    [integrationId, userId]
  );
  const initialIntegration = initialRows[0];
  if (!initialIntegration) {
    throw new ApiError(404, 'Conexao bancaria nao encontrada.', 'INTEGRATION_NOT_FOUND');
  }

  const fetched = await fetchAllItemTransactions(
    client,
    initialIntegration.access_token_enc,
    maxTransactions
  );
  const connection = await database.getClient();
  let transactionStarted = false;
  try {
    await connection.query('BEGIN');
    transactionStarted = true;
    const { rows: lockedRows } = await connection.query(
      `SELECT * FROM open_finance_tokens
        WHERE id = $1 AND id_usuario = $2 AND ativo = TRUE
        FOR UPDATE`,
      [integrationId, userId]
    );
    const integration = lockedRows[0];
    if (!integration || integration.access_token_enc !== initialIntegration.access_token_enc) {
      throw new ApiError(409, 'A conexao mudou durante a sincronizacao. Tente novamente.');
    }

    const { rows: categories } = await connection.query(
      `SELECT id, nome, tipo FROM categoria
        WHERE sistema = TRUE OR id_usuario = $1
        ORDER BY sistema DESC, nome ASC`,
      [userId]
    );

    const budgets = new Map();
    let budgetsCreated = 0;
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;

    for (const transaction of fetched.transactions) {
      const [year, month] = transaction.data.split('-').map(Number);
      if (year < 2000 || year > 2100) {
        throw new ApiError(422, `Data fora do intervalo suportado: ${transaction.data}.`);
      }
      const budgetKey = `${year}-${month}`;
      let budgetId = budgets.get(budgetKey);
      if (!budgetId) {
        const { rows: budgetRows } = await connection.query(
          `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT (id_usuario, mes, ano)
           DO UPDATE SET id_usuario = EXCLUDED.id_usuario
           RETURNING id, (xmax = 0) AS inserido`,
          [userId, month, year]
        );
        budgetId = budgetRows[0].id;
        if (budgetRows[0].inserido === true || budgetRows[0].inserido === 'true') budgetsCreated += 1;
        budgets.set(budgetKey, budgetId);
      }

      const category = chooseCategory(categories, transaction);
      if (!category) {
        throw new ApiError(500, `Nenhuma categoria compativel para ${transaction.tipo}.`);
      }

      const { rows: existingRows } = await connection.query(
        `SELECT d.*
           FROM despesas d
           JOIN orcamento o ON o.id = d.id_orcamento
          WHERE d.id_externo = $1
            AND (d.id_integracao = $2 OR (d.id_integracao IS NULL AND o.id_usuario = $3))
          ORDER BY (d.id_integracao = $2) DESC
          LIMIT 1
          FOR UPDATE OF d`,
        [transaction.id_externo, integration.id, userId]
      );
      const existing = existingRows[0];
      const metadata = {
        instituicao: integration.instituicao,
        origin: 'pluggy',
        accountId: transaction.accountId,
        accountName: transaction.accountName,
        pluggyCategory: transaction.pluggyCategory,
      };

      if (existing) {
        const isUnchanged =
          existing.id_integracao === integration.id &&
          existing.id_orcamento === budgetId &&
          existing.id_categoria === category.id &&
          Number(existing.valor) === transaction.valor &&
          existing.data_transacao === transaction.data &&
          existing.descricao === transaction.descricao &&
          existing.tipo === transaction.tipo &&
          existing.status === transaction.status;
        if (isUnchanged) {
          unchanged += 1;
          continue;
        }
        await connection.query(
          `UPDATE despesas
              SET id_integracao = $1, id_orcamento = $2, id_categoria = $3,
                  id_metas = NULL, valor = $4, data_transacao = $5,
                  descricao = $6, tipo = $7, origem = 'open_finance',
                  status = $8, nlp_metadata = $9
            WHERE id = $10`,
          [
            integration.id, budgetId, category.id, transaction.valor,
            transaction.data, transaction.descricao, transaction.tipo,
            transaction.status, metadata, existing.id,
          ]
        );
        updated += 1;
      } else {
        await connection.query(
          `INSERT INTO despesas
             (id_integracao, id_orcamento, id_categoria, id_metas, valor,
              data_transacao, descricao, tipo, origem, status, nlp_metadata, id_externo)
           VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'open_finance', $8, $9, $10)`,
          [
            integration.id, budgetId, category.id, transaction.valor,
            transaction.data, transaction.descricao, transaction.tipo,
            transaction.status, metadata, transaction.id_externo,
          ]
        );
        inserted += 1;
      }
    }

    const { rows: usageRows } = await connection.query(
      `UPDATE open_finance_tokens SET ultimo_uso = NOW()
        WHERE id = $1 RETURNING ultimo_uso`,
      [integration.id]
    );
    await connection.query('COMMIT');
    transactionStarted = false;

    return {
      integrationId: integration.id,
      accounts: fetched.accounts.length,
      found: fetched.transactions.length,
      inserted,
      updated,
      unchanged,
      budgetsCreated,
      syncedAt: usageRows[0]?.ultimo_uso || new Date().toISOString(),
    };
  } catch (err) {
    if (transactionStarted) await connection.query('ROLLBACK');
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  buildConnectTokenOptions,
  chooseCategory,
  fetchAllItemTransactions,
  getOwnedIntegrationByItem,
  getPluggyClient,
  normalizePluggyTransaction,
  publicIntegration,
  syncIntegration,
};
