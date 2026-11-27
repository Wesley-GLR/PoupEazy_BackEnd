BEGIN;

CREATE TABLE IF NOT EXISTS preferencias_email (
    id_usuario UUID PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    alerta_orcamento_ativo BOOLEAN NOT NULL DEFAULT FALSE,
    alerta_orcamento_percentual SMALLINT NOT NULL DEFAULT 80 CHECK (alerta_orcamento_percentual BETWEEN 1 AND 100)
);

CREATE TABLE IF NOT EXISTS email_alertas_orcamento (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    id_usuario UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    ano INT NOT NULL CHECK (ano BETWEEN 2000 AND 2100),
    mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
    tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('limiar', 'excesso')),
    estado VARCHAR(12) NOT NULL CHECK (estado IN ('reservado', 'enviado', 'coberto', 'cancelado', 'incerto', 'falhou')),
    percentual SMALLINT NOT NULL CHECK (percentual BETWEEN 1 AND 100),
    valor_planejado NUMERIC NOT NULL CHECK (valor_planejado > 0),
    gasto_confirmado NUMERIC NOT NULL CHECK (gasto_confirmado >= 0),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_alerta_orcamento_periodo UNIQUE (id_usuario, ano, mes, tipo)
);

-- Sem FK para orcamento: recriar um orcamento nao deve apagar a deduplicacao.
CREATE INDEX IF NOT EXISTS idx_email_alertas_orcamento_reservados
    ON email_alertas_orcamento (criado_em) WHERE estado = 'reservado';

ALTER TABLE preferencias_email ADD COLUMN IF NOT EXISTS alerta_despesa_ativo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE preferencias_email ADD COLUMN IF NOT EXISTS alerta_despesa_valor_minimo NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (alerta_despesa_valor_minimo BETWEEN 0.01 AND 9999999999.99);
ALTER TABLE preferencias_email ADD COLUMN IF NOT EXISTS alerta_receita_ativo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE preferencias_email ADD COLUMN IF NOT EXISTS alerta_receita_valor_minimo NUMERIC(12,2) NOT NULL DEFAULT 100 CHECK (alerta_receita_valor_minimo BETWEEN 0.01 AND 9999999999.99);
ALTER TABLE preferencias_email ADD COLUMN IF NOT EXISTS alerta_meta_concluida_ativo BOOLEAN NOT NULL DEFAULT FALSE;

-- Sem FKs: triggers financeiros nao podem adquirir KEY SHARE no usuario,
-- invertendo o lock usuario -> despesas/metas usado pela exclusao da conta.
CREATE TABLE IF NOT EXISTS email_alertas_eventos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), id_usuario UUID NOT NULL, id_origem UUID NOT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('despesa', 'receita', 'meta_concluida')),
    estado VARCHAR(12) NOT NULL DEFAULT 'pendente' CHECK (estado IN ('pendente', 'reservado', 'enviado', 'cancelado', 'incerto', 'falhou')),
    valor_evento NUMERIC NOT NULL, valor_referencia NUMERIC NOT NULL, data_evento DATE NOT NULL, lote_id UUID,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_email_alerta_evento_origem UNIQUE (id_usuario, id_origem, tipo)
);
CREATE INDEX IF NOT EXISTS idx_email_alertas_eventos_pendentes ON email_alertas_eventos (estado, id_usuario, tipo, criado_em);
CREATE INDEX IF NOT EXISTS idx_email_alertas_eventos_lote ON email_alertas_eventos (lote_id) WHERE lote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_email_novo_lancamento()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'confirmada' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'confirmada' THEN RETURN NEW; END IF;
    INSERT INTO email_alertas_eventos (id_usuario, id_origem, tipo, valor_evento, valor_referencia, data_evento)
    SELECT o.id_usuario, NEW.id, NEW.tipo, NEW.valor,
           CASE WHEN NEW.tipo = 'despesa' THEN p.alerta_despesa_valor_minimo ELSE p.alerta_receita_valor_minimo END,
           NEW.data_transacao
      FROM orcamento o JOIN preferencias_email p ON p.id_usuario = o.id_usuario JOIN usuarios u ON u.id = o.id_usuario
     WHERE o.id = NEW.id_orcamento AND u.email_verificado_em IS NOT NULL
       AND ((NEW.tipo = 'despesa' AND p.alerta_despesa_ativo AND NEW.valor >= p.alerta_despesa_valor_minimo)
         OR (NEW.tipo = 'receita' AND p.alerta_receita_ativo AND NEW.valor >= p.alerta_receita_valor_minimo))
    ON CONFLICT (id_usuario, id_origem, tipo) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_novo_lancamento ON despesas;
CREATE TRIGGER trg_email_novo_lancamento AFTER INSERT OR UPDATE OF status ON despesas
    FOR EACH ROW EXECUTE FUNCTION fn_email_novo_lancamento();

CREATE OR REPLACE FUNCTION fn_email_meta_concluida()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE completed BOOLEAN; became_complete BOOLEAN;
BEGIN
    completed := NEW.status = 'concluida' OR (NEW.status = 'ativa' AND NEW.valor_atual >= NEW.valor_objetivo);
    IF NOT completed THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN became_complete := TRUE;
    ELSE
        became_complete := (NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida')
          OR (NEW.status = 'ativa' AND NEW.valor_atual >= NEW.valor_objetivo
              AND NOT (OLD.status <> 'cancelada' AND OLD.valor_atual >= OLD.valor_objetivo));
    END IF;
    IF NOT became_complete THEN RETURN NEW; END IF;
    INSERT INTO email_alertas_eventos (id_usuario, id_origem, tipo, valor_evento, valor_referencia, data_evento)
    SELECT NEW.id_usuario, NEW.id, 'meta_concluida', NEW.valor_atual, NEW.valor_objetivo,
           (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
      FROM preferencias_email p JOIN usuarios u ON u.id = p.id_usuario
     WHERE p.id_usuario = NEW.id_usuario AND p.alerta_meta_concluida_ativo AND u.email_verificado_em IS NOT NULL
    ON CONFLICT (id_usuario, id_origem, tipo) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_meta_concluida ON metas;
CREATE TRIGGER trg_email_meta_concluida AFTER INSERT OR UPDATE OF status, valor_atual, valor_objetivo ON metas
    FOR EACH ROW EXECUTE FUNCTION fn_email_meta_concluida();

COMMIT;
