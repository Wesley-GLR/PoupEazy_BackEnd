// Erro de aplicacao com status HTTP explicito.
// Lancado pelas rotas/controllers quando uma regra de negocio falha.
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Rota nao encontrada -> 404 padronizado.
function notFound(req, res) {
  res.status(404).json({ error: `Rota nao encontrada: ${req.method} ${req.originalUrl}` });
}

// Tratador central de erros. Mantem o formato { error: string } em toda a API.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    return res.status(err.status).json(body);
  }

  // JSON malformado e payload acima do limite configurado pelo Express.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON malformado.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Corpo da requisicao excede o limite permitido.' });
  }

  // Violacao de UNIQUE no PostgreSQL.
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'Registro ja existe (violacao de unicidade).' });
  }


  // Erros comuns de entrada do PostgreSQL nao devem virar 500.
  if (err && ['22P02', '22001', '22003', '22007', '22008', '23502'].includes(err.code)) {
    return res.status(400).json({ error: 'Dados informados sao invalidos.' });
  }
  if (err && err.code === '23503') {
    return res.status(409).json({ error: 'O registro esta em uso ou referencia um item inexistente.' });
  }
  if (err && err.code === '23514') {
    return res.status(422).json({ error: 'Os dados violam uma regra de negocio.' });
  }

  // eslint-disable-next-line no-console
  console.error('[errorHandler] Erro nao tratado:', err);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = { ApiError, notFound, errorHandler };
