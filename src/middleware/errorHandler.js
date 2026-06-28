// Erro de aplicacao com status HTTP explicito.
// Lancado pelas rotas/controllers quando uma regra de negocio falha.
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
    return res.status(err.status).json({ error: err.message });
  }

  // Violacao de UNIQUE no PostgreSQL.
  if (err && err.code === '23505') {
    return res.status(409).json({ error: 'Registro ja existe (violacao de unicidade).' });
  }

  // eslint-disable-next-line no-console
  console.error('[errorHandler] Erro nao tratado:', err);
  return res.status(500).json({ error: 'Erro interno do servidor.' });
}

module.exports = { ApiError, notFound, errorHandler };
