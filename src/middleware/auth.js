const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { ApiError } = require('./errorHandler');
const { validateUuid } = require('../utils/validation');

function credentialMarker(usuario) {
  return crypto.createHmac('sha256', config.jwtSecret)
    .update('poupeazy-credentials-v1\0').update(usuario.id).update('\0')
    .update(usuario.senha_hash).digest('hex');
}

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
    if (typeof payload.cred !== 'string' || !/^[a-f0-9]{64}$/.test(payload.cred)) throw new Error('legacy-token');
  } catch (err) {
    return next(new ApiError(401, 'Token invalido ou expirado.'));
  }

  try {
    // Exclusao ou troca/reset de senha invalida todos os JWTs ja emitidos.
    const { rows: [usuario] } = await db.query('SELECT id, senha_hash FROM usuarios WHERE id = $1', [payload.sub]);
    if (!usuario || !crypto.timingSafeEqual(Buffer.from(payload.cred, 'hex'), Buffer.from(credentialMarker(usuario), 'hex'))) {
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
  return jwt.sign({ sub: usuario.id, email: usuario.email, cred: credentialMarker(usuario) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

module.exports = { auth, gerarToken };
