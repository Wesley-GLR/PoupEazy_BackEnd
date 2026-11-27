const { ApiError } = require('../middleware/errorHandler');
const DEFAULTS = Object.freeze({
  alerta_orcamento_ativo: false, alerta_orcamento_percentual: 80,
  alerta_despesa_ativo: false, alerta_despesa_valor_minimo: 100,
  alerta_receita_ativo: false, alerta_receita_valor_minimo: 100,
  alerta_meta_concluida_ativo: false,
});
const FIELDS = Object.keys(DEFAULTS);
const FLAGS = FIELDS.filter((field) => field.endsWith('_ativo'));

function normalizeEmailPreferences(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Informe um objeto JSON.');
  if (!Object.keys(body).length || Object.keys(body).some((key) => !FIELDS.includes(key))) throw new ApiError(400, 'Informe apenas preferencias de e-mail editaveis.');
  for (const field of FLAGS) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'boolean') throw new ApiError(422, `${field} deve ser verdadeiro ou falso.`);
  }
  if (Object.hasOwn(body, 'alerta_orcamento_percentual') && (!Number.isInteger(body.alerta_orcamento_percentual)
      || body.alerta_orcamento_percentual < 1 || body.alerta_orcamento_percentual > 100)) {
    throw new ApiError(422, 'O percentual deve ser um numero inteiro entre 1 e 100.');
  }
  for (const field of ['alerta_despesa_valor_minimo', 'alerta_receita_valor_minimo']) {
    if (Object.hasOwn(body, field) && (typeof body[field] !== 'number' || !Number.isFinite(body[field])
        || body[field] < 0.01 || body[field] > 9999999999.99 || Math.round(body[field] * 100) / 100 !== body[field])) {
      throw new ApiError(422, 'O valor minimo deve ficar entre 0,01 e 9999999999,99, com ate duas casas decimais.');
    }
  }
  return body;
}

async function getEmailPreferences(database, userId) {
  const { rows: [row] } = await database.query(
    `SELECT ${FIELDS.map((field) => `COALESCE(p.${field}, ${typeof DEFAULTS[field] === 'boolean' ? 'FALSE' : DEFAULTS[field]}) AS ${field}`).join(',')},
            (u.email_verificado_em IS NOT NULL) AS email_verificado
       FROM usuarios u LEFT JOIN preferencias_email p ON p.id_usuario = u.id WHERE u.id = $1`, [userId]
  );
  if (!row) throw new ApiError(401, 'Usuario nao encontrado.');
  return { ...row, alerta_despesa_valor_minimo: Number(row.alerta_despesa_valor_minimo), alerta_receita_valor_minimo: Number(row.alerta_receita_valor_minimo) };
}

async function updateEmailPreferences(database, userId, body) {
  const patch = normalizeEmailPreferences(body);
  const client = await database.getClient();
  let started = false;
  try {
    await client.query('BEGIN'); started = true;
    const { rows: [user] } = await client.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [userId]);
    if (!user) throw new ApiError(401, 'Usuario nao encontrado.');
    const current = await getEmailPreferences(client, userId);
    const effective = { ...current, ...patch };
    if (FLAGS.some((flag) => effective[flag]) && !current.email_verificado) throw new ApiError(403, 'Confirme seu e-mail para ativar estes alertas.', 'EMAIL_NOT_VERIFIED');
    await client.query(
      `INSERT INTO preferencias_email (id_usuario,${FIELDS.join(',')}) VALUES ($1,${FIELDS.map((field, index) => `$${index + 2}`).join(',')})
       ON CONFLICT (id_usuario) DO UPDATE SET ${FIELDS.map((field) => `${field} = EXCLUDED.${field}`).join(',')}`,
      [userId, ...FIELDS.map((field) => effective[field])]
    );
    if (!effective.alerta_orcamento_ativo) {
      await client.query("UPDATE email_alertas_orcamento SET estado = 'cancelado', atualizado_em = NOW() WHERE id_usuario = $1 AND estado = 'reservado'", [userId]);
    }
    const cancelledTypes = [!effective.alerta_despesa_ativo && 'despesa', !effective.alerta_receita_ativo && 'receita', !effective.alerta_meta_concluida_ativo && 'meta_concluida'].filter(Boolean);
    await client.query("UPDATE email_alertas_eventos SET estado = 'cancelado', atualizado_em = NOW() WHERE id_usuario = $1 AND tipo = ANY($2::text[]) AND estado IN ('pendente','reservado')", [userId, cancelledTypes]);
    await client.query('COMMIT'); started = false;
    return effective;
  } catch (error) { if (started) await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

module.exports = { normalizeEmailPreferences, getEmailPreferences, updateEmailPreferences, DEFAULTS };
