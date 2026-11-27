const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { auth, gerarToken } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { validateEmail, validateString } = require('../utils/validation');
const { deleteAccount } = require('../services/account-deletion.service');
const { createGmailService, GmailEmailError } = require('../services/gmail.service');
const { preparePasswordReset, consumePasswordReset } = require('../services/password-reset.service');

// Remove campos sensiveis antes de devolver o usuario para o cliente.
function publicUser(u) {
  return { id: u.id, email: u.email, criado_em: u.criado_em };
}

function validatePassword(value, fieldName = 'password') {
  if (typeof value !== 'string') {
    throw new ApiError(400, `${fieldName} deve ser texto.`);
  }
  if (value.length < 6) {
    throw new ApiError(422, 'A senha deve ter pelo menos 6 caracteres.');
  }
  // bcrypt considera apenas os primeiros 72 bytes; rejeitar evita senhas
  // aparentemente diferentes que gerariam o mesmo hash.
  if (Buffer.byteLength(value, 'utf8') > 72) {
    throw new ApiError(422, 'A senha deve ter no maximo 72 bytes.');
  }
  return value;
}

function createAuthRouter({ sendEmail } = {}) {
const router = express.Router();
// A injecao explicita habilita apenas o transporte falso nos testes.
const emailAvailable = typeof sendEmail === 'function' || config.email.enabled;
const deliverEmail = sendEmail || createGmailService(config.email).send;

// POST /api/auth/register
// Cria usuario + profile em uma unica transacao (substitui o trigger handle_new_user).
router.post('/register', async (req, res, next) => {
  const { password, nome, telefone } = req.body || {};

  if (!req.body?.email || !password) {
    return next(new ApiError(400, 'email e password sao obrigatorios.'));
  }

  let email;
  let senha;
  let nomeNormalizado;
  let telefoneNormalizado;
  try {
    email = validateEmail(req.body.email);
    senha = validatePassword(password);
    nomeNormalizado = nome == null ? '' : validateString(nome, 'nome', { max: 150, allowEmpty: true });
    telefoneNormalizado = telefone == null
      ? null
      : validateString(telefone, 'telefone', { max: 20, allowEmpty: true }) || null;
  } catch (err) {
    return next(err);
  }

  let client;
  let transactionStarted = false;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    transactionStarted = true;

    const existe = await client.query('SELECT 1 FROM usuarios WHERE LOWER(email) = $1', [email]);
    if (existe.rowCount > 0) {
      throw new ApiError(409, 'Ja existe uma conta com este e-mail.');
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const { rows: usuarioRows } = await client.query(
      'INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2) RETURNING *',
      [email, senhaHash]
    );
    const usuario = usuarioRows[0];

    const { rows: profileRows } = await client.query(
      'INSERT INTO profiles (id, nome, telefone) VALUES ($1, $2, $3) RETURNING *',
      [usuario.id, nomeNormalizado, telefoneNormalizado]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const token = gerarToken(usuario);
    return res.status(201).json({ token, user: publicUser(usuario), profile: profileRows[0] });
  } catch (err) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // eslint-disable-next-line no-console
        console.error('[auth] Falha ao desfazer cadastro:', rollbackError);
      }
    }
    return next(err);
  } finally {
    client?.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  const { password } = req.body || {};
  if (!req.body?.email || !password) {
    return next(new ApiError(400, 'email e password sao obrigatorios.'));
  }

  try {
    const email = validateEmail(req.body.email);
    // No login nao revelamos se a senha falhou em formato ou credencial.
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
      throw new ApiError(401, 'E-mail ou senha invalidos.');
    }
    const { rows } = await db.query('SELECT * FROM usuarios WHERE LOWER(email) = $1', [email]);
    const usuario = rows[0];
    if (!usuario) {
      throw new ApiError(401, 'E-mail ou senha invalidos.');
    }

    const ok = await bcrypt.compare(String(password), usuario.senha_hash);
    if (!ok) {
      throw new ApiError(401, 'E-mail ou senha invalidos.');
    }

    const { rows: profileRows } = await db.query('SELECT * FROM profiles WHERE id = $1', [usuario.id]);
    const token = gerarToken(usuario);
    return res.json({ token, user: publicUser(usuario), profile: profileRows[0] || null });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/delete-account (publico, com reautenticacao e confirmacao)
router.post('/delete-account', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const { email, password, confirmacao } = req.body || {};
  if (!email || !password) {
    return next(new ApiError(400, 'email e password sao obrigatorios.'));
  }
  if (confirmacao !== 'EXCLUIR') {
    return next(new ApiError(400, 'Confirme a exclusao digitando EXCLUIR.'));
  }
  try {
    const normalizedEmail = validateEmail(email);
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
      throw new ApiError(401, 'E-mail ou senha invalidos.');
    }
    await deleteAccount({ database: db, email: normalizedEmail, password });
    return res.json({ message: 'Conta e dados associados excluidos da base ativa do PoupEazy.' });
  } catch (error) {
    return next(error);
  }
});

// GET /api/auth/me  (substitui getSession + fetchProfile do Supabase)
router.get('/me', auth, async (req, res, next) => {
  try {
    const { rows: usuarioRows } = await db.query('SELECT * FROM usuarios WHERE id = $1', [req.userId]);
    const usuario = usuarioRows[0];
    if (!usuario) {
      throw new ApiError(401, 'Usuario nao encontrado.');
    }
    const { rows: profileRows } = await db.query('SELECT * FROM profiles WHERE id = $1', [req.userId]);
    return res.json({ user: publicUser(usuario), profile: profileRows[0] || null });
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!req.body?.email) {
    return next(new ApiError(400, 'email e obrigatorio.'));
  }

  try {
    const email = validateEmail(req.body.email);
    if (!emailAvailable) {
      throw new ApiError(503, 'A recuperacao de senha esta temporariamente indisponivel.', 'EMAIL_DISABLED');
    }
    const message = await preparePasswordReset({ database: db, email, resetUrl: config.passwordResetUrl });
    if (message) {
      // O transporte comeca depois da resposta: sua latencia nao revela contas.
      // Sem fila duravel nesta etapa; reinicio pode exigir novo pedido apos 60s.
      res.once('finish', () => {
        Promise.resolve().then(() => deliverEmail(message)).catch((error) => {
          const code = error instanceof GmailEmailError
            ? new GmailEmailError(error.code).code : 'EMAIL_SEND_UNKNOWN';
          console.error(`[password-reset] ${code}`);
        });
      });
    }
    return res.json({ message: 'Se houver uma conta com esse e-mail, voce recebera um link para redefinir a senha. Aguarde pelo menos 60 segundos antes de tentar novamente.' });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    console.error('[password-reset] RESET_DATABASE_FAILED');
    return next(new ApiError(503, 'A recuperacao de senha esta temporariamente indisponivel.', 'RESET_UNAVAILABLE'));
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const { token, novaSenha } = req.body || {};
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    return next(new ApiError(400, 'Token de recuperacao invalido ou expirado.', 'RESET_TOKEN_INVALID'));
  }

  try {
    if (typeof novaSenha !== 'string') throw new ApiError(422, 'Informe uma nova senha valida.');
    const senha = validatePassword(novaSenha, 'novaSenha');
    const senhaHash = await bcrypt.hash(senha, 10);
    const consumed = await consumePasswordReset({ database: db, token, passwordHash: senhaHash });
    if (!consumed) throw new ApiError(400, 'Token de recuperacao invalido ou expirado.', 'RESET_TOKEN_INVALID');
    return res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    console.error('[password-reset] RESET_DATABASE_FAILED');
    return next(new ApiError(503, 'Nao foi possivel redefinir a senha. Tente novamente.', 'RESET_UNAVAILABLE'));
  }
});

// PATCH /api/auth/password  (troca de senha do usuario autenticado)
router.patch('/password', auth, async (req, res, next) => {
  const { novaSenha } = req.body || {};
  if (!novaSenha) {
    return next(new ApiError(400, 'novaSenha e obrigatoria.'));
  }

  try {
    const senha = validatePassword(novaSenha, 'novaSenha');
    const senhaHash = await bcrypt.hash(senha, 10);
    await db.query('UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_expira_em = NULL WHERE id = $2', [senhaHash, req.userId]);
    return res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err) {
    return next(err);
  }
});

return router;
}

module.exports = { createAuthRouter, validatePassword };
