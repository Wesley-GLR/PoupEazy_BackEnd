BEGIN;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificado_em TIMESTAMPTZ;
-- O DEFAULT FALSE no ADD preserva o acesso das contas existentes, sem afirmar
-- que o endereco foi verificado. Nao executar UPDATE geral nesta migration.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email_verificacao_obrigatoria BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verificacao_token_hash TEXT;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS verificacao_expira_em TIMESTAMPTZ;

-- Apenas insercoes futuras passam a exigir confirmacao. Reexecutar nao muda
-- contas antigas nem libera contas novas ainda aguardando a confirmacao.
ALTER TABLE usuarios ALTER COLUMN email_verificacao_obrigatoria SET DEFAULT TRUE;

COMMIT;
