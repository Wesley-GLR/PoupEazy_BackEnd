BEGIN;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS relatorio_email_solicitado_em TIMESTAMPTZ;
COMMIT;
