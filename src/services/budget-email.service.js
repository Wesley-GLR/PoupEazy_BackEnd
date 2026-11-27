const { GmailEmailError } = require('../config/email');
const { budgetAlertEmail } = require('../emails/budget-alert');

const INTERVAL_MS = 60000;
const SNAPSHOT_SQL = `SELECT u.id AS id_usuario, u.email, o.ano, o.mes, o.valor_planejado,
  p.alerta_orcamento_percentual AS percentual,
  COALESCE(SUM(d.valor) FILTER (WHERE d.tipo = 'despesa' AND d.status = 'confirmada'), 0) AS gasto_confirmado
  FROM usuarios u JOIN preferencias_email p ON p.id_usuario = u.id
  JOIN orcamento o ON o.id_usuario = u.id LEFT JOIN despesas d ON d.id_orcamento = o.id
  WHERE u.email_verificado_em IS NOT NULL AND p.alerta_orcamento_ativo = TRUE
    AND o.valor_planejado > 0 AND o.ano = $1 AND o.mes = $2
  GROUP BY u.id, o.id, p.id_usuario`;

function currentBudgetPeriod(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return { ano: Number(parts.find((part) => part.type === 'year').value), mes: Number(parts.find((part) => part.type === 'month').value) };
}

function cents(value) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('invalid-money');
  return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
}

function budgetAlertDecisions(snapshot, existing = []) {
  const planned = cents(snapshot.valor_planejado);
  const spent = cents(snapshot.gasto_confirmado);
  if (planned <= 0n) return [];
  const seen = new Set(existing);
  if (spent > planned && !seen.has('excesso')) {
    return [...(!seen.has('limiar') ? [{ tipo: 'limiar', estado: 'coberto' }] : []), { tipo: 'excesso', estado: 'reservado' }];
  }
  if (!seen.has('limiar') && !seen.has('excesso') && spent * 100n >= planned * BigInt(snapshot.percentual)) {
    return [{ tipo: 'limiar', estado: 'reservado' }];
  }
  return [];
}

function createBudgetEmailWorker({ database, sendEmail, enabled = false, resetUrl, now = () => new Date(), intervalMs = INTERVAL_MS } = {}) {
  let running = false;
  let timer;

  async function reserve(userId, period) {
    const client = await database.getClient();
    let started = false;
    try {
      await client.query('BEGIN'); started = true;
      const { rows: [user] } = await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [userId]);
      if (!user) { await client.query('COMMIT'); started = false; return []; }
      const { rows } = await client.query(`/* budget-email:snapshot */ SELECT * FROM (${SNAPSHOT_SQL}) s WHERE id_usuario = $3`, [period.ano, period.mes, userId]);
      if (!rows[0]) { await client.query('COMMIT'); started = false; return []; }
      const snapshot = rows[0];
      const { rows: previous } = await client.query('SELECT tipo FROM email_alertas_orcamento WHERE id_usuario = $1 AND ano = $2 AND mes = $3', [userId, period.ano, period.mes]);
      const events = [];
      for (const decision of budgetAlertDecisions(snapshot, previous.map((event) => event.tipo))) {
        const { rows: [event] } = await client.query(
          `INSERT INTO email_alertas_orcamento (id_usuario, ano, mes, tipo, estado, percentual, valor_planejado, gasto_confirmado)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id_usuario, ano, mes, tipo) DO NOTHING RETURNING id, tipo, estado`,
          [userId, period.ano, period.mes, decision.tipo, decision.estado, snapshot.percentual, snapshot.valor_planejado, snapshot.gasto_confirmado]
        );
        if (event) events.push({ ...event, id_usuario: userId, ano: period.ano, mes: period.mes });
      }
      await client.query('COMMIT'); started = false;
      return events;
    } catch (error) {
      if (started) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function setState(id, state) {
    await database.query("UPDATE email_alertas_orcamento SET estado = $2, atualizado_em = NOW() WHERE id = $1 AND estado = 'reservado'", [id, state]);
  }

  async function attempt(event, stats) {
    const current = currentBudgetPeriod(now());
    const { rows: [snapshot] } = await database.query(
      `/* budget-email:revalidate */ SELECT s.* FROM (${SNAPSHOT_SQL}) s
       JOIN email_alertas_orcamento e ON e.id_usuario = s.id_usuario AND e.ano = s.ano AND e.mes = s.mes
       WHERE e.id = $3 AND e.estado = 'reservado'`, [current.ano, current.mes, event.id]
    );
    const eligible = snapshot && (event.tipo === 'excesso'
      ? cents(snapshot.gasto_confirmado) > cents(snapshot.valor_planejado)
      : cents(snapshot.gasto_confirmado) * 100n >= cents(snapshot.valor_planejado) * BigInt(snapshot.percentual));
    if (!eligible) { await setState(event.id, 'cancelado'); stats.cancelled += 1; return; }
    const { rowCount } = await database.query(
      "UPDATE email_alertas_orcamento SET percentual = $2, valor_planejado = $3, gasto_confirmado = $4, atualizado_em = NOW() WHERE id = $1 AND estado = 'reservado'",
      [event.id, snapshot.percentual, snapshot.valor_planejado, snapshot.gasto_confirmado]
    );
    // Exclusao/desativacao pode ter cancelado a reserva entre a leitura e o UPDATE.
    if (!rowCount) { stats.cancelled += 1; return; }
    try {
      await sendEmail(budgetAlertEmail(snapshot, event.tipo, resetUrl));
    } catch (error) {
      const code = error instanceof GmailEmailError ? new GmailEmailError(error.code).code : 'EMAIL_SEND_UNKNOWN';
      const state = code === 'EMAIL_SEND_UNKNOWN' ? 'incerto' : 'falhou';
      console.error(`[budget-email] ${code}`);
      await setState(event.id, state);
      stats[state === 'incerto' ? 'unknown' : 'failed'] += 1;
      return;
    }
    stats.sent += 1;
    try { await setState(event.id, 'enviado'); }
    catch { console.error('[budget-email] EVENT_ACK_FAILED'); stats.errors += 1; }
  }

  async function runOnce() {
    const stats = { scanned: 0, reserved: 0, covered: 0, sent: 0, cancelled: 0, unknown: 0, failed: 0, errors: 0 };
    if (!enabled || running) return stats;
    running = true;
    try {
      await database.query("UPDATE email_alertas_orcamento SET estado = 'incerto', atualizado_em = NOW() WHERE estado = 'reservado' AND atualizado_em < NOW() - INTERVAL '2 minutes'");
      const period = currentBudgetPeriod(now());
      const { rows: candidates } = await database.query(`/* budget-email:candidates */ ${SNAPSHOT_SQL} ORDER BY u.id`, [period.ano, period.mes]);
      stats.scanned = candidates.length;
      for (const candidate of candidates) {
        try {
          const events = await reserve(candidate.id_usuario, period);
          for (const event of events) {
            if (event.estado === 'coberto') { stats.covered += 1; continue; }
            stats.reserved += 1;
            await attempt(event, stats);
          }
        } catch {
          console.error('[budget-email] EVENT_PROCESSING_FAILED'); stats.errors += 1;
        }
      }
    } catch { console.error('[budget-email] WORKER_DATABASE_FAILED'); stats.errors += 1; }
    finally { running = false; }
    return stats;
  }

  function start() {
    if (!enabled || timer) return;
    void runOnce();
    timer = setInterval(() => { void runOnce(); }, intervalMs);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = undefined; }
  return { runOnce, start, stop };
}

module.exports = { createBudgetEmailWorker, currentBudgetPeriod, budgetAlertDecisions };
