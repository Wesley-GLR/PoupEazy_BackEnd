const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { ApiError } = require('./errorHandler');
const { validateUuid } = require('../utils/validation');

// Middleware de autenticacao.
// Substitui o auth.uid() do Supabase: extrai o id do usuario do token JWT
// e o disponibiliza em req.userId para que as rotas filtrem os dados por dono.
async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Token de autenticacao ausente.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
    validateUuid(payload.sub, 'usuario');
  } catch (err) {
    return next(new ApiError(401, 'Token invalido ou expirado.'));
  }

  try {
    // JWTs emitidos antes da exclusao nao podem continuar acessando recursos.
    const { rowCount } = await db.query('SELECT 1 FROM usuarios WHERE id = $1', [payload.sub]);
    if (!rowCount) {
      return next(new ApiError(401, 'Token invalido ou expirado.'));
    }
    req.userId = payload.sub;
    req.userEmail = payload.email;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Gera um token assinado para o usuario informado.
function gerarToken(usuario) {
  return jwt.sign({ sub: usuario.id, email: usuario.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { auth, gerarToken };
