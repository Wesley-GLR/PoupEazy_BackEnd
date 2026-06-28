const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const { auth, gerarToken } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');

const router = express.Router();

// Remove campos sensiveis antes de devolver o usuario para o cliente.
function publicUser(u) {
  return { id: u.id, email: u.email, criado_em: u.criado_em };
}

// POST /api/auth/register
// Cria usuario + profile em uma unica transacao (substitui o trigger handle_new_user).
router.post('/register', async (req, res, next) => {
  const { email, password, nome, telefone } = req.body || {};

  if (!email || !password) {
    return next(new ApiError(400, 'email e password sao obrigatorios.'));
  }
  if (String(password).length < 6) {
    return next(new ApiError(400, 'A senha deve ter pelo menos 6 caracteres.'));
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const existe = await client.query('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (existe.rowCount > 0) {
      throw new ApiError(409, 'Ja existe uma conta com este e-mail.');
    }

    const senhaHash = await bcrypt.hash(String(password), 10);
    const { rows: usuarioRows } = await client.query(
      'INSERT INTO usuarios (email, senha_hash) VALUES ($1, $2) RETURNING *',
      [email, senhaHash]
    );
    const usuario = usuarioRows[0];

    const { rows: profileRows } = await client.query(
      'INSERT INTO profiles (id, nome, telefone) VALUES ($1, $2, $3) RETURNING *',
      [usuario.id, nome || '', telefone || null]
    );

    await client.query('COMMIT');

    const token = gerarToken(usuario);
    return res.status(201).json({ token, user: publicUser(usuario), profile: profileRows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return next(new ApiError(400, 'email e password sao obrigatorios.'));
  }

  try {
    const { rows } = await db.query('SELECT * FROM usuarios WHERE email = $1', [email]);
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
// Gera um token de reset valido por 1h. Em desenvolvimento, retorna o token no corpo
// para testar via Postman (sem precisar de servidor de e-mail).
router.post('/forgot-password', async (req, res, next) => {
  const { email } = req.body || {};
  if (!email) {
    return next(new ApiError(400, 'email e obrigatorio.'));
  }

  try {
    const { rows } = await db.query('SELECT id FROM usuarios WHERE email = $1', [email]);
    const usuario = rows[0];

    // Mensagem generica sempre (nao revela se o e-mail existe).
    const respostaPadrao = {
      message: 'Se o e-mail existir, um link de recuperacao foi gerado.',
    };

    if (!usuario) {
      return res.json(respostaPadrao);
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiraEm = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await db.query(
      'UPDATE usuarios SET reset_token = $1, reset_expira_em = $2 WHERE id = $3',
      [resetToken, expiraEm, usuario.id]
    );

    if (config.isDev) {
      // Apenas em DEV: facilita o teste manual.
      return res.json({ ...respostaPadrao, resetToken });
    }
    return res.json(respostaPadrao);
  } catch (err) {
    return next(err);
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha) {
    return next(new ApiError(400, 'token e novaSenha sao obrigatorios.'));
  }
  if (String(novaSenha).length < 6) {
    return next(new ApiError(400, 'A senha deve ter pelo menos 6 caracteres.'));
  }

  try {
    const { rows } = await db.query(
      'SELECT * FROM usuarios WHERE reset_token = $1 AND reset_expira_em > NOW()',
      [token]
    );
    const usuario = rows[0];
    if (!usuario) {
      throw new ApiError(400, 'Token de recuperacao invalido ou expirado.');
    }

    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await db.query(
      'UPDATE usuarios SET senha_hash = $1, reset_token = NULL, reset_expira_em = NULL WHERE id = $2',
      [senhaHash, usuario.id]
    );

    return res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/auth/password  (troca de senha do usuario autenticado)
router.patch('/password', auth, async (req, res, next) => {
  const { novaSenha } = req.body || {};
  if (!novaSenha) {
    return next(new ApiError(400, 'novaSenha e obrigatoria.'));
  }
  if (String(novaSenha).length < 6) {
    return next(new ApiError(400, 'A senha deve ter pelo menos 6 caracteres.'));
  }

  try {
    const senhaHash = await bcrypt.hash(String(novaSenha), 10);
    await db.query('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [senhaHash, req.userId]);
    return res.json({ message: 'Senha atualizada com sucesso.' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
