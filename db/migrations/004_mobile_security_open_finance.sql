-- Ajustes necessarios para o app mobile e para a sincronizacao segura da Pluggy.
-- Execute uma vez no banco existente antes de usar POST /api/pluggy/sync/:integrationId.

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_lower ON usuarios (LOWER(email));

ALTER TABLE despesas ADD COLUMN IF NOT EXISTS id_externo VARCHAR(255);
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS id_integracao UUID;

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

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'despesas_id_integracao_fkey'
    ) THEN
        ALTER TABLE despesas
            ADD CONSTRAINT despesas_id_integracao_fkey
            FOREIGN KEY (id_integracao) REFERENCES open_finance_tokens(id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_despesas_integracao_externo
    ON despesas (id_integracao, id_externo) WHERE id_integracao IS NOT NULL;
