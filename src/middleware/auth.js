const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('./errorHandler');

// Middleware de autenticacao.
// Substitui o auth.uid() do Supabase: extrai o id do usuario do token JWT
// e o disponibiliza em req.userId para que as rotas filtrem os dados por dono.
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Token de autenticacao ausente.'));
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Token invalido ou expirado.'));
  }
}

// Gera um token assinado para o usuario informado.
function gerarToken(usuario) {
  return jwt.sign({ sub: usuario.id, email: usuario.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { auth, gerarToken };
