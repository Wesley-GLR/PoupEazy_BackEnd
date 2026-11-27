const { ApiError } = require('../middleware/errorHandler');
const { validateDateOnly } = require('../utils/validation');
const SECTIONS = ['resumo', 'transacoes', 'categorias', 'orcamentos', 'metas'];
const FORMATS = ['pdf', 'csv'];
const invalid = () => new ApiError(422, 'Escolha datas validas, pelo menos uma secao e um formato de relatorio.', 'REPORT_REQUEST_INVALID');
function normalizeReportRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['data_inicio', 'data_fim', 'secoes', 'formatos'].includes(key))) throw invalid();
  try { validateDateOnly(body.data_inicio); validateDateOnly(body.data_fim); } catch { throw invalid(); }
  if (![body.data_inicio, body.data_fim].every((date) => date >= '2000-01-01' && date <= '2100-12-31')) throw invalid();
  const days = (Date.parse(body.data_fim) - Date.parse(body.data_inicio)) / 86400000 + 1;
  if (days < 1 || days > 366) throw invalid();
  for (const [field, allowed] of [['secoes', SECTIONS], ['formatos', FORMATS]]) {
    if (!Array.isArray(body[field]) || !body[field].length || body[field].length > allowed.length
        || new Set(body[field]).size !== body[field].length || body[field].some((item) => !allowed.includes(item))) throw invalid();
  }
  return { data_inicio: body.data_inicio, data_fim: body.data_fim,
    secoes: SECTIONS.filter((section) => body.secoes.includes(section)), formatos: FORMATS.filter((format) => body.formatos.includes(format)) };
}

const SCOPE = `FROM despesas d JOIN orcamento o ON o.id = d.id_orcamento
  WHERE o.id_usuario = $1 AND d.status = 'confirmada' AND d.data_transacao BETWEEN $2::date AND $3::date`;
const CATEGORY = `LEFT JOIN categoria c ON c.id = d.id_categoria AND (c.id_usuario = $1 OR (c.sistema = TRUE AND c.id_usuario IS NULL))`;

async function collectReportSnapshot({ database, userId, request }) {
  const client = await database.getClient(); let started = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); started = true;
    await client.query("SET LOCAL statement_timeout = '5s'");
    const { rows: [user] } = await client.query('SELECT id, email, email_verificado_em, CURRENT_TIMESTAMP AS gerado_em FROM usuarios WHERE id = $1', [userId]);
    if (!user) throw new ApiError(401, 'Usuario nao encontrado.');
    if (!user.email_verificado_em) throw new ApiError(403, 'Confirme seu e-mail para receber relatorios.', 'EMAIL_NOT_VERIFIED');
    const args = [userId, request.data_inicio, request.data_fim];
    const { rows: [count] } = await client.query(`SELECT COUNT(*)::int AS total FROM (SELECT d.id ${SCOPE} LIMIT 1001) selected`, args);
    if (count.total > 1000) throw new ApiError(422, 'O periodo tem mais de 1000 transacoes confirmadas. Reduza o intervalo.', 'REPORT_LIMIT_EXCEEDED');
    const dados = {};
    for (const section of request.secoes) {
      if (section === 'resumo') {
        dados.resumo = (await client.query(`SELECT COALESCE(SUM(d.valor) FILTER (WHERE d.tipo='receita'),0)::text AS receitas,
          COALESCE(SUM(d.valor) FILTER (WHERE d.tipo='despesa'),0)::text AS despesas,
          COALESCE(SUM(CASE WHEN d.tipo='receita' THEN d.valor ELSE -d.valor END),0)::text AS saldo,
          COUNT(*)::int AS transacoes ${SCOPE}`, args)).rows[0];
      } else if (section === 'transacoes') {
        dados.transacoes = (await client.query(`SELECT d.data_transacao::text AS data, d.descricao,
          COALESCE(c.nome,'Categoria indisponivel') AS categoria, d.tipo, d.valor::text, d.origem
          FROM despesas d JOIN orcamento o ON o.id=d.id_orcamento ${CATEGORY}
          WHERE o.id_usuario=$1 AND d.status='confirmada' AND d.data_transacao BETWEEN $2::date AND $3::date
          ORDER BY d.data_transacao, d.id`, args)).rows;
      } else if (section === 'categorias') {
        dados.categorias = (await client.query(`SELECT COALESCE(c.nome,'Categoria indisponivel') AS categoria,
          d.tipo, SUM(d.valor)::text AS total, COUNT(*)::int AS quantidade
          FROM despesas d JOIN orcamento o ON o.id=d.id_orcamento ${CATEGORY}
          WHERE o.id_usuario=$1 AND d.status='confirmada' AND d.data_transacao BETWEEN $2::date AND $3::date
          GROUP BY c.id,c.nome,d.tipo ORDER BY d.tipo,categoria`, args)).rows;
      } else if (section === 'orcamentos') {
        dados.orcamentos = (await client.query(`SELECT o.ano,o.mes,o.valor_planejado::text,
          COALESCE(SUM(d.valor) FILTER (WHERE d.tipo='despesa' AND d.status='confirmada' AND d.data_transacao BETWEEN $2::date AND $3::date),0)::text AS gasto_periodo,
          GREATEST($2::date,make_date(o.ano,o.mes,1))::text AS inicio_coberto,
          LEAST($3::date,(make_date(o.ano,o.mes,1)+INTERVAL '1 month - 1 day')::date)::text AS fim_coberto,
          ($2::date>make_date(o.ano,o.mes,1) OR $3::date<(make_date(o.ano,o.mes,1)+INTERVAL '1 month - 1 day')::date) AS mes_parcial
          FROM orcamento o LEFT JOIN despesas d ON d.id_orcamento=o.id
          WHERE o.id_usuario=$1 AND make_date(o.ano,o.mes,1) BETWEEN date_trunc('month',$2::date)::date AND date_trunc('month',$3::date)::date
          GROUP BY o.id ORDER BY o.ano,o.mes`, args)).rows;
      } else if (section === 'metas') {
        dados.metas = (await client.query(`SELECT m.nome,m.status,m.valor_objetivo::text,m.valor_atual::text,m.data_limite::text,
          COALESCE(SUM(d.valor) FILTER (WHERE d.tipo='despesa'),0)::text AS aportes_periodo,
          COALESCE(SUM(d.valor) FILTER (WHERE d.tipo='receita'),0)::text AS retiradas_periodo,
          COALESCE(SUM(CASE WHEN d.tipo='despesa' THEN d.valor ELSE -d.valor END),0)::text AS movimento_periodo
          FROM metas m LEFT JOIN despesas d ON d.id_metas=m.id AND d.status='confirmada'
            AND d.data_transacao BETWEEN $2::date AND $3::date AND d.id_orcamento IN (SELECT id FROM orcamento WHERE id_usuario=$1)
          WHERE m.id_usuario=$1 GROUP BY m.id ORDER BY m.criado_em,m.id LIMIT 201`, args)).rows;
        if (dados.metas.length > 200) throw new ApiError(422, 'Ha mais de 200 metas. Desmarque a secao de metas para gerar o relatorio.', 'REPORT_LIMIT_EXCEEDED');
      }
    }
    await client.query('COMMIT'); started = false;
    return { user: { id: user.id, email: user.email }, report: { data_inicio: request.data_inicio, data_fim: request.data_fim,
      gerado_em: new Date(user.gerado_em).toISOString(), secoes: [...request.secoes], dados } };
  } catch (error) { if (started) await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports = { normalizeReportRequest, collectReportSnapshot, SECTIONS, FORMATS };
