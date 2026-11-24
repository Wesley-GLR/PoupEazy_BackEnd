const { createHash, randomBytes } = require('node:crypto');
const db = require('../db');
const { ApiError } = require('../middleware/errorHandler');
const { createTransaction } = require('./despesas.service');
const { getOrCreateBudget } = require('./orcamentos.service');
const {
  currency, localDate, FORMAT, HELP, LINK_HELP, normalizeCommand,
  parseExpense, reportCommands, getReportRange, describeExpense,
} = require('./whatsapp-text');

const hash = (value) => createHash('sha256').update(value).digest('hex');

async function inTransaction(work) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function linkStatus(userId) {
  const { rowCount } = await db.query('SELECT 1 FROM whatsapp_vinculos WHERE id_usuario = $1', [userId]);
  return rowCount > 0;
}

async function createLinkCode(userId) {
  const code = randomBytes(16).toString('hex');
  return inTransaction(async (client) => {
    // Serializa emissão, consumo e desvinculação para a mesma conta.
    const { rowCount } = await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [userId]);
    if (!rowCount) throw new ApiError(404, 'Perfil não encontrado.');
    const existing = await client.query('SELECT 1 FROM whatsapp_vinculos WHERE id_usuario = $1', [userId]);
    if (existing.rowCount) throw new ApiError(409, 'Esta conta já tem um WhatsApp vinculado.');
    const { rows: [row] } = await client.query(
      `INSERT INTO whatsapp_codigos (id_usuario, codigo_hash, expira_em)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
       ON CONFLICT (id_usuario) DO UPDATE
       SET codigo_hash = EXCLUDED.codigo_hash, expira_em = EXCLUDED.expira_em
       RETURNING expira_em`,
      [userId, hash(code)]
    );
    return { code, expiresAt: row.expira_em };
  });
}

async function unlink(userId) {
  await inTransaction(async (client) => {
    await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [userId]);
    await client.query('DELETE FROM whatsapp_codigos WHERE id_usuario = $1', [userId]);
    const { rows: [link] } = await client.query(
      'SELECT id FROM whatsapp_vinculos WHERE id_usuario = $1 FOR UPDATE', [userId]
    );
    if (!link) return;

    await client.query(
      'UPDATE whatsapp_mensagens SET id_vinculo = NULL, resposta = NULL, relatorio = NULL WHERE id_vinculo = $1', [link.id]
    );
    await client.query('DELETE FROM whatsapp_vinculos WHERE id = $1', [link.id]);
  });
}

async function consumeLinkCode(client, sender, code) {
  const digest = hash(code);
  const { rows: [owner] } = await client.query(
    'SELECT id_usuario FROM whatsapp_codigos WHERE codigo_hash = $1 AND expira_em > NOW()', [digest]
  );
  if (!owner) return null;
  await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [owner.id_usuario]);
  const { rowCount } = await client.query(
    `DELETE FROM whatsapp_codigos WHERE id_usuario = $1 AND codigo_hash = $2
      AND expira_em > NOW()`, [owner.id_usuario, digest]
  );
  if (!rowCount) return null;

  const { rows: [link] } = await client.query(
    `INSERT INTO whatsapp_vinculos (id_usuario, wa_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [owner.id_usuario, sender]
  );
  return link ?? null;
}

async function getReport(client, userId, period) {
  const { title, start, end } = getReportRange(period, new Date());
  const { rows: [totals] } = await client.query(
    `WITH por_categoria AS (
       SELECT c.nome, d.tipo, SUM(d.valor) AS total
         FROM despesas d
         JOIN orcamento o ON o.id = d.id_orcamento
         JOIN categoria c ON c.id = d.id_categoria
        WHERE o.id_usuario = $1 AND d.status = 'confirmada'
          AND ($2::date IS NULL OR d.data_transacao >= $2::date)
          AND d.data_transacao <= $3::date
        GROUP BY c.nome, d.tipo
     ), principais AS (
       SELECT nome, total FROM por_categoria WHERE tipo = 'despesa'
       ORDER BY total DESC, nome LIMIT 3
     )
     SELECT COALESCE(SUM(total) FILTER (WHERE tipo = 'receita'), 0) AS receitas,
            COALESCE(SUM(total) FILTER (WHERE tipo = 'despesa'), 0) AS gastos,
            COALESCE(SUM(CASE WHEN tipo = 'receita' THEN total ELSE -total END), 0) AS saldo,
            (SELECT json_agg(principais ORDER BY total DESC, nome) FROM principais) AS categorias
       FROM por_categoria`,
    [userId, start, end]
  );

  const lines = [
    `*Resumo · ${title}*`,
    `Entradas: ${currency.format(totals.receitas)}`,
    `Gastos: ${currency.format(totals.gastos)}`,
    `Saldo do período: ${currency.format(totals.saldo)}`,
  ];
  if (totals.categorias?.length) {
    lines.push('', '*Maiores gastos por categoria*');
    for (const { nome, total } of totals.categorias) {
      const share = Number(total) / Number(totals.gastos);
      const filled = Math.max(1, Math.round(share * 10));
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
      const percent = share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`;
      lines.push(`• ${nome}: ${currency.format(total)}`, `${bar} ${percent}`);
    }
  }
  return {
    text: lines.join('\n'),
    report: { title, start, end, ...totals },
  };
}

async function saveExpense(client, userId, pending) {
  const { rows: [category] } = await client.query(
    `SELECT id FROM categoria
      WHERE sistema = TRUE AND id_usuario IS NULL AND nome = 'Outros' AND tipo = 'despesa_variavel'
      ORDER BY id LIMIT 1`
  );
  if (!category) throw new ApiError(503, 'Categoria padrão para o WhatsApp indisponível.');
  const [ano, mes] = pending.date.split('-').map(Number);
  const budget = await getOrCreateBudget(client, userId, { mes, ano });
  await createTransaction(client, userId, {
    id_orcamento: budget.id,
    id_categoria: category.id,
    valor: pending.value,
    descricao: pending.description,
    data_transacao: pending.date,
    tipo: 'despesa',
    origem: 'chatbot',
    id_externo: `wa:${hash(pending.messageId)}`,
  });
}

async function processLinkedMessage(client, link, message, command) {
  const period = reportCommands.get(command);
  if (period) return getReport(client, link.id_usuario, period);
  if (/^relatorio\b/.test(command)) return 'Escolha relatório diário, semanal, mensal ou total.';
  if (['menu', 'ajuda', 'oi', 'ola'].includes(command)) return HELP;

  const pending = link.pendencia_expira_em > new Date() ? link.pendencia : null;
  if (['sim', 'nao', 'cancelar'].includes(command)) {
    if (!pending || message.timestamp < pending.timestamp) {
      return `Não há um gasto aguardando esta confirmação. ${FORMAT}`;
    }
    if (command === 'sim') await saveExpense(client, link.id_usuario, pending);

    await client.query(
      'UPDATE whatsapp_vinculos SET pendencia = NULL, pendencia_expira_em = NULL WHERE id = $1', [link.id]
    );
    return command === 'sim'
      ? `Gasto registrado ✅ ${describeExpense(pending)}. Já está no extrato do PoupEazy.`
      : 'Gasto cancelado. Pode enviar outro quando quiser.';
  }
  if (pending) return `Aguardando confirmação de ${describeExpense(pending)}. Responda sim ou cancelar.`;

  const expense = parseExpense(message.text);
  if (!expense) return FORMAT;
  const draft = {
    ...expense, date: localDate.format(new Date(message.timestamp * 1000)),
    messageId: message.id, timestamp: message.timestamp,
  };
  await client.query(
    `UPDATE whatsapp_vinculos SET pendencia = $2, pendencia_expira_em = NOW() + INTERVAL '15 minutes'
      WHERE id = $1`,
    [link.id, draft]
  );
  return `Registrar ${describeExpense(expense)} na categoria Outros? Responda sim ou cancelar (em até 15 minutos).`;
}

async function recordMessage(message) {
  await inTransaction(async (client) => {
    const receipt = await client.query(
      'INSERT INTO whatsapp_mensagens (id) VALUES ($1) ON CONFLICT DO NOTHING', [message.id]
    );
    if (!receipt.rowCount) return;

    const command = normalizeCommand(message.text);
    const code = /^vincular ([a-f0-9]{32})$/.exec(command);
    let link;
    let reply;
    if (code) {
      link = await consumeLinkCode(client, message.sender, code[1]);
      reply = link ? `WhatsApp vinculado ao PoupEazy ✅\n${HELP}`
        : 'Código inválido, expirado ou vínculo já existente. Confira o vínculo em Transações no PoupEazy.';
    } else {
      const { rows } = await client.query(
        'SELECT * FROM whatsapp_vinculos WHERE wa_id = $1 FOR UPDATE', [message.sender]
      );
      link = rows[0];
      reply = link ? await processLinkedMessage(client, link, message, command) : LINK_HELP;
    }
    const { text, report = null } = typeof reply === 'string' ? { text: reply } : reply;
    await client.query(
      'UPDATE whatsapp_mensagens SET resposta = $2, id_vinculo = $3, relatorio = $4 WHERE id = $1',
      [message.id, text, link?.id ?? null, report]
    );
  });
}

async function deliverReply(message, sendText) {
  // Em caso de falha no envio, o próximo webhook tenta só a resposta já calculada.
  await inTransaction(async (client) => {
    const { rows: [receipt] } = await client.query(
      'SELECT resposta, relatorio FROM whatsapp_mensagens WHERE id = $1 FOR UPDATE', [message.id]
    );
    if (!receipt?.resposta) return;
    await sendText(message.sender, receipt.resposta, receipt.relatorio);
    await client.query('UPDATE whatsapp_mensagens SET resposta = NULL, relatorio = NULL WHERE id = $1', [message.id]);
  });
}

async function handleMessages(messages, sendText) {
  if (!messages.length) return;
  await db.query("DELETE FROM whatsapp_mensagens WHERE criada_em < NOW() - INTERVAL '2 days'");
  for (const message of messages) {
    await recordMessage(message);
    await deliverReply(message, sendText);
  }
}

module.exports = { linkStatus, createLinkCode, unlink, handleMessages };
