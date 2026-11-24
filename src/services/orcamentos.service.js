async function getOrCreateBudget(queryable, userId, { mes, ano, valorPlanejado = 0 }) {
  const { rows } = await queryable.query(
    `INSERT INTO orcamento (id_usuario, mes, ano, valor_planejado)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id_usuario, mes, ano)
     DO UPDATE SET id_usuario = EXCLUDED.id_usuario
     RETURNING *`,
    [userId, mes, ano, valorPlanejado]
  );
  return rows[0];
}

module.exports = { getOrCreateBudget };
