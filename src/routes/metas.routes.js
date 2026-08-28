const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const {
  hasOwn,
  validateDateOnly,
  validateEnum,
  validatePositiveMoney,
  validateString,
  validateUuid,
} = require('../utils/validation');

const router = express.Router();

// GET /api/metas
router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM metas WHERE id_usuario = $1 ORDER BY data_limite ASC',
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

// POST /api/metas
router.post('/', auth, async (req, res, next) => {
  const { nome, descricao, valor_objetivo, data_limite, status } = req.body || {};
  if (!nome || valor_objetivo == null || !data_limite) {
    return next(new ApiError(400, 'nome, valor_objetivo e data_limite sao obrigatorios.'));
  }
  try {
    const values = {
      nome: validateString(nome, 'nome', { max: 100 }),
      descricao: descricao == null ? null : validateString(descricao, 'descricao', { max: 2000, allowEmpty: true }) || null,
      valorObjetivo: validatePositiveMoney(valor_objetivo, 'valor_objetivo'),
      dataLimite: validateDateOnly(data_limite, 'data_limite'),
      status: status == null ? 'ativa' : validateEnum(status, ['ativa', 'concluida', 'cancelada'], 'status'),
    };
    const { rows } = await db.query(
      `INSERT INTO metas (id_usuario, nome, descricao, valor_objetivo, data_limite, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.userId, values.nome, values.descricao, values.valorObjetivo, values.dataLimite, values.status]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// PATCH /api/metas/:id
router.patch('/:id', auth, async (req, res, next) => {
  const body = req.body || {};
  try {
    validateUuid(req.params.id, 'id');
    const fields = ['nome', 'descricao', 'valor_objetivo', 'data_limite', 'status'];
    if (!fields.some((field) => hasOwn(body, field))) {
      throw new ApiError(400, 'Informe ao menos um campo para atualizar.');
    }

    const nome = hasOwn(body, 'nome') ? validateString(body.nome, 'nome', { max: 100 }) : null;
    const descricao = hasOwn(body, 'descricao')
      ? body.descricao == null
        ? null
        : validateString(body.descricao, 'descricao', { max: 2000, allowEmpty: true }) || null
      : null;
    const valorObjetivo = hasOwn(body, 'valor_objetivo')
      ? validatePositiveMoney(body.valor_objetivo, 'valor_objetivo')
      : null;
    const dataLimite = hasOwn(body, 'data_limite')
      ? validateDateOnly(body.data_limite, 'data_limite')
      : null;
    const status = hasOwn(body, 'status')
      ? validateEnum(body.status, ['ativa', 'concluida', 'cancelada'], 'status')
      : null;

    const { rows } = await db.query(
      `UPDATE metas
         SET nome = CASE WHEN $1 THEN $2 ELSE nome END,
             descricao = CASE WHEN $3 THEN $4 ELSE descricao END,
             valor_objetivo = CASE WHEN $5 THEN $6 ELSE valor_objetivo END,
             data_limite = CASE WHEN $7 THEN $8 ELSE data_limite END,
             status = CASE WHEN $9 THEN $10 ELSE status END
       WHERE id = $11 AND id_usuario = $12
       RETURNING *`,
      [
        hasOwn(body, 'nome'), nome,
        hasOwn(body, 'descricao'), descricao,
        hasOwn(body, 'valor_objetivo'), valorObjetivo,
        hasOwn(body, 'data_limite'), dataLimite,
        hasOwn(body, 'status'), status,
        req.params.id, req.userId,
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Meta nao encontrada.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

// DELETE /api/metas/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    validateUuid(req.params.id, 'id');
    const { rowCount } = await db.query(
      'DELETE FROM metas WHERE id = $1 AND id_usuario = $2',
      [req.params.id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Meta nao encontrada.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
