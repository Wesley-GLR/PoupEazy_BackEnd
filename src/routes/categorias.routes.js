const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const { hasOwn, validateEnum, validateString, validateUuid } = require('../utils/validation');

const router = express.Router();
const CATEGORY_TYPES = ['despesa_fixa', 'despesa_variavel', 'receita'];

function normalizeCategory(body, partial = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'O corpo da requisicao deve ser um objeto JSON.');
  }
  if (!partial && (!hasOwn(body, 'nome') || !hasOwn(body, 'tipo'))) {
    throw new ApiError(400, 'nome e tipo sao obrigatorios.');
  }
  if (partial && !['nome', 'tipo', 'icone'].some((field) => hasOwn(body, field))) {
    throw new ApiError(400, 'Informe ao menos um campo para atualizar.');
  }
  const result = {};
  if (hasOwn(body, 'nome')) result.nome = validateString(body.nome, 'nome', { max: 100 });
  if (hasOwn(body, 'tipo')) result.tipo = validateEnum(body.tipo, CATEGORY_TYPES, 'tipo');
  if (hasOwn(body, 'icone')) {
    result.icone = body.icone == null
      ? null
      : validateString(body.icone, 'icone', { max: 50, allowEmpty: true }) || null;
  }
  return result;
}

router.get('/', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM categoria
        WHERE sistema = TRUE OR id_usuario = $1
        ORDER BY sistema DESC, nome ASC`,
      [req.userId]
    );
    return res.json(rows);
  } catch (err) {
    return next(err);
  }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const category = normalizeCategory(req.body);
    const { rows } = await db.query(
      `INSERT INTO categoria (id_usuario, nome, tipo, icone, sistema)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING *`,
      [req.userId, category.nome, category.tipo, category.icone ?? null]
    );
    return res.status(201).json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id', auth, async (req, res, next) => {
  try {
    const id = validateUuid(req.params.id, 'id');
    const patch = normalizeCategory(req.body, true);

    if (hasOwn(patch, 'tipo')) {
      const { rows } = await db.query(
        `SELECT c.tipo, EXISTS(SELECT 1 FROM despesas d WHERE d.id_categoria = c.id) AS em_uso
           FROM categoria c
          WHERE c.id = $1 AND c.id_usuario = $2 AND c.sistema = FALSE`,
        [id, req.userId]
      );
      if (!rows[0]) throw new ApiError(404, 'Categoria nao encontrada ou protegida.');
      if (rows[0].em_uso && rows[0].tipo !== patch.tipo) {
        throw new ApiError(409, 'O tipo de uma categoria em uso nao pode ser alterado.');
      }
    }

    const { rows } = await db.query(
      `UPDATE categoria
          SET nome = CASE WHEN $1 THEN $2 ELSE nome END,
              tipo = CASE WHEN $3 THEN $4 ELSE tipo END,
              icone = CASE WHEN $5 THEN $6 ELSE icone END
        WHERE id = $7 AND id_usuario = $8 AND sistema = FALSE
        RETURNING *`,
      [
        hasOwn(patch, 'nome'), patch.nome ?? null,
        hasOwn(patch, 'tipo'), patch.tipo ?? null,
        hasOwn(patch, 'icone'), patch.icone ?? null,
        id, req.userId,
      ]
    );
    if (!rows[0]) throw new ApiError(404, 'Categoria nao encontrada ou protegida.');
    return res.json(rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const id = validateUuid(req.params.id, 'id');
    const { rowCount } = await db.query(
      'DELETE FROM categoria WHERE id = $1 AND id_usuario = $2 AND sistema = FALSE',
      [id, req.userId]
    );
    if (rowCount === 0) throw new ApiError(404, 'Categoria nao encontrada ou protegida.');
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
module.exports.normalizeCategory = normalizeCategory;
