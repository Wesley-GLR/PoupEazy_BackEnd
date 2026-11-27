const { randomUUID } = require('node:crypto');
const { GmailEmailError } = require('../config/email');
const { financialEventsEmail } = require('../emails/financial-events');

const VALID_EVENTS_SQL = `SELECT e.id, e.tipo, u.email, d.valor AS valor_evento,
 CASE WHEN e.tipo = 'despesa' THEN p.alerta_despesa_valor_minimo ELSE p.alerta_receita_valor_minimo END AS valor_referencia,
 to_char(d.data_transacao, 'DD/MM/YYYY') AS data_exibicao
 FROM email_alertas_eventos e JOIN usuarios u ON u.id = e.id_usuario JOIN preferencias_email p ON p.id_usuario = u.id
 JOIN despesas d ON d.id = e.id_origem AND d.tipo = e.tipo JOIN orcamento o ON o.id = d.id_orcamento AND o.id_usuario = u.id
 WHERE e.id = ANY($1::uuid[]) AND u.email_verificado_em IS NOT NULL AND d.status = 'confirmada'
 AND ((e.tipo = 'despesa' AND p.alerta_despesa_ativo AND d.valor >= p.alerta_despesa_valor_minimo)
   OR (e.tipo = 'receita' AND p.alerta_receita_ativo AND d.valor >= p.alerta_receita_valor_minimo))
 UNION ALL
 SELECT e.id, e.tipo, u.email, m.valor_atual AS valor_evento, m.valor_objetivo AS valor_referencia,
 to_char(e.criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY') AS data_exibicao
 FROM email_alertas_eventos e JOIN usuarios u ON u.id = e.id_usuario JOIN preferencias_email p ON p.id_usuario = u.id
 JOIN metas m ON m.id = e.id_origem AND m.id_usuario = u.id
 WHERE e.id = ANY($1::uuid[]) AND e.tipo = 'meta_concluida' AND u.email_verificado_em IS NOT NULL
 AND p.alerta_meta_concluida_ativo AND (m.status = 'concluida' OR (m.status = 'ativa' AND m.valor_atual >= m.valor_objetivo))`;

function createFinancialEventEmailWorker({ database, sendEmail, enabled = false, resetUrl } = {}) {
  let running = false;
  async function reserveBatch(userId, tipo) {
    const client = await database.getClient(); let started = false;
    try {
      await client.query('BEGIN'); started = true;
      // Usuario antes dos eventos. Nenhum lock de despesas/metas durante o envio.
      const { rows: [user] } = await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [userId]);
      if (!user) { await client.query('COMMIT'); started = false; return null; }
      const { rows: pending } = await client.query("SELECT id FROM email_alertas_eventos WHERE id_usuario = $1 AND tipo = $2 AND estado = 'pendente' ORDER BY id FOR UPDATE", [userId, tipo]);
      const ids = pending.map((event) => event.id);
      if (!ids.length) { await client.query('COMMIT'); started = false; return null; }
      const { rows: valid } = await client.query(VALID_EVENTS_SQL, [ids]);
      const validIds = valid.map((event) => event.id);
      await client.query("UPDATE email_alertas_eventos SET estado = 'cancelado', atualizado_em = NOW() WHERE id = ANY($1::uuid[]) AND NOT (id = ANY($2::uuid[]))", [ids, validIds]);
      const loteId = randomUUID();
      await client.query("UPDATE email_alertas_eventos SET estado = 'reservado', lote_id = $2, atualizado_em = NOW() WHERE id = ANY($1::uuid[]) AND estado = 'pendente'", [validIds, loteId]);
      await client.query('COMMIT'); started = false;
      return valid.length ? { loteId, tipo } : null;
    } catch (error) { if (started) await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function setBatchState(loteId, estado) {
    await database.query("UPDATE email_alertas_eventos SET estado = $2, atualizado_em = NOW() WHERE lote_id = $1 AND estado = 'reservado'", [loteId, estado]);
  }
  async function attempt(batch, stats) {
    const { rows: current } = await database.query("SELECT id FROM email_alertas_eventos WHERE lote_id = $1 AND estado = 'reservado'", [batch.loteId]);
    const { rows } = await database.query(VALID_EVENTS_SQL, [current.map((event) => event.id)]);
    const ids = rows.map((event) => event.id);
    await database.query("UPDATE email_alertas_eventos SET estado = 'cancelado', atualizado_em = NOW() WHERE lote_id = $1 AND estado = 'reservado' AND NOT (id = ANY($2::uuid[]))", [batch.loteId, ids]);
    if (!rows.length) { stats.cancelled += 1; return; }
    const { rows: stillReserved } = await database.query("UPDATE email_alertas_eventos SET atualizado_em = NOW() WHERE lote_id = $1 AND estado = 'reservado' RETURNING id", [batch.loteId]);
    const liveIds = new Set(stillReserved.map((event) => event.id));
    const live = rows.filter((event) => liveIds.has(event.id));
    if (!live.length) { stats.cancelled += 1; return; }
    try { await sendEmail(financialEventsEmail(live[0].email, batch.tipo, live, resetUrl)); }
    catch (error) {
      const code = error instanceof GmailEmailError ? new GmailEmailError(error.code).code : 'EMAIL_SEND_UNKNOWN';
      console.error(`[financial-email] ${code}`);
      await setBatchState(batch.loteId, code === 'EMAIL_SEND_UNKNOWN' ? 'incerto' : 'falhou');
      stats.failed += 1; return;
    }
    stats.sent += 1;
    try { await setBatchState(batch.loteId, 'enviado'); }
    catch { console.error('[financial-email] EVENT_ACK_FAILED'); stats.errors += 1; }
  }
  async function runOnce() {
    const stats = { groups: 0, sent: 0, cancelled: 0, failed: 0, errors: 0 };
    if (!enabled || running) return stats;
    running = true;
    try {
      await database.query('DELETE FROM email_alertas_eventos e WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = e.id_usuario)');
      await database.query("UPDATE email_alertas_eventos SET estado = 'incerto', atualizado_em = NOW() WHERE estado = 'reservado' AND atualizado_em < NOW() - INTERVAL '2 minutes'");
      const { rows: groups } = await database.query("SELECT DISTINCT id_usuario, tipo FROM email_alertas_eventos WHERE estado = 'pendente' ORDER BY id_usuario, tipo");
      stats.groups = groups.length;
      for (const group of groups) {
        try { const batch = await reserveBatch(group.id_usuario, group.tipo); if (batch) await attempt(batch, stats); }
        catch { console.error('[financial-email] EVENT_PROCESSING_FAILED'); stats.errors += 1; }
      }
    } catch { console.error('[financial-email] WORKER_DATABASE_FAILED'); stats.errors += 1; }
    finally { running = false; }
    return stats;
  }
  return { runOnce };
}
module.exports = { createFinancialEventEmailWorker };
