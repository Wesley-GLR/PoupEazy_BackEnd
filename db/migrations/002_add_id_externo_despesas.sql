ALTER TABLE despesas ADD COLUMN IF NOT EXISTS id_externo VARCHAR(255);
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_despesas_id_externo'
          AND conrelid = 'despesas'::regclass
    ) THEN
        ALTER TABLE despesas
            ADD CONSTRAINT uq_despesas_id_externo UNIQUE (id_orcamento, id_externo);
    END IF;
END;
$$;
