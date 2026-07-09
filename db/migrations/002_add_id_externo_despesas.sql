ALTER TABLE despesas ADD COLUMN IF NOT EXISTS id_externo VARCHAR(255);
ALTER TABLE despesas ADD CONSTRAINT uq_despesas_id_externo UNIQUE (id_orcamento, id_externo);