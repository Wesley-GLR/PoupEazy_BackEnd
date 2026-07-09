-- =============================================================================
--  MIGRATION: ATUALIZACAO DO SCHEMA PARA NEON / POSTGRESQL
--
--  Objetivo:
--   - aplicar as alteracoes feitas no schema.sql sem recriar tudo do zero;
--   - manter compatibilidade com a migration 002 (id_externo em despesas);
--   - ser idempotente para rodar com seguranca em um banco ja parcialmente atualizado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- EXTENSOES
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- -----------------------------------------------------------------------------
-- USUARIOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255)  NOT NULL UNIQUE,
    senha_hash      TEXT          NOT NULL,
    reset_token     TEXT,
    reset_expira_em TIMESTAMPTZ,
    criado_em       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE usuarios IS 'Credenciais de autenticacao. Substitui auth.users do Supabase.';

-- Se a tabela profiles ja existir, garante a FK para usuarios.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'profiles'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_class r ON r.oid = c.confrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'profiles'
              AND c.contype = 'f'
              AND c.conname = 'profiles_id_fkey'
              AND r.relname <> 'usuarios'
        ) THEN
            ALTER TABLE profiles DROP CONSTRAINT profiles_id_fkey;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_class r ON r.oid = c.confrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            WHERE n.nspname = 'public'
              AND t.relname = 'profiles'
              AND c.contype = 'f'
              AND r.relname = 'usuarios'
        ) THEN
            IF NOT EXISTS (
                SELECT 1
                FROM profiles p
                LEFT JOIN usuarios u ON u.id = p.id
                WHERE u.id IS NULL
                LIMIT 1
            ) THEN
                ALTER TABLE profiles
                    ADD CONSTRAINT profiles_id_fkey
                    FOREIGN KEY (id) REFERENCES usuarios(id) ON DELETE CASCADE;
            ELSE
                RAISE NOTICE 'Skipping FK profiles_id_fkey because there are existing profiles without matching usuarios rows.';
            END IF;
        END IF;
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- DESPESAS: id_externo + constraint unica
-- -----------------------------------------------------------------------------
ALTER TABLE despesas
    ADD COLUMN IF NOT EXISTS id_externo VARCHAR(255);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public'
          AND t.relname = 'despesas'
          AND c.conname = 'uq_despesas_id_externo'
    ) THEN
        ALTER TABLE despesas
            ADD CONSTRAINT uq_despesas_id_externo UNIQUE (id_orcamento, id_externo);
    END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- METAS: recalculo do valor atual com a regra nova do schema
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_sync_metas_valor_atual()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_ids_metas UUID[];
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_ids_metas := ARRAY[OLD.id_metas];
    ELSIF TG_OP = 'UPDATE' THEN
        v_ids_metas := ARRAY[NEW.id_metas, OLD.id_metas];
    ELSE
        v_ids_metas := ARRAY[NEW.id_metas];
    END IF;

    UPDATE metas m
    SET valor_atual = (
        SELECT COALESCE(SUM(CASE WHEN d.tipo = 'despesa' THEN d.valor ELSE -d.valor END), 0.00)
        FROM despesas d
        WHERE d.id_metas = m.id AND d.status = 'confirmada'
    )
    WHERE m.id = ANY(v_ids_metas) AND m.id IS NOT NULL;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_metas_valor_atual ON despesas;
CREATE TRIGGER trg_metas_valor_atual
    AFTER INSERT OR UPDATE OR DELETE ON despesas
    FOR EACH ROW EXECUTE FUNCTION fn_sync_metas_valor_atual();

-- -----------------------------------------------------------------------------
-- ORCAMENTO: garante o trigger de sincronizacao do valor real
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_orcamento_valor_real ON despesas;
CREATE TRIGGER trg_orcamento_valor_real
    AFTER INSERT OR UPDATE OR DELETE ON despesas
    FOR EACH ROW EXECUTE FUNCTION fn_sync_orcamento_valor_real();

-- -----------------------------------------------------------------------------
-- VIEWS do schema atual
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_resumo_mensal AS
SELECT
    p.id         AS id_usuario,
    p.nome       AS usuario_nome,
    o.ano, o.mes,
    c.nome       AS categoria_nome,
    c.tipo       AS categoria_tipo,
    SUM(d.valor) AS total_gasto,
    COUNT(d.id)  AS qtd_transacoes,
    o.valor_planejado,
    o.valor_real,
    ROUND((o.valor_real / NULLIF(o.valor_planejado, 0)) * 100, 2) AS pct_orcamento_consumido
FROM despesas d
JOIN orcamento o ON o.id = d.id_orcamento
JOIN profiles  p ON p.id = o.id_usuario
JOIN categoria c ON c.id = d.id_categoria
WHERE d.status = 'confirmada' AND d.tipo = 'despesa'
GROUP BY p.id, p.nome, o.id, o.ano, o.mes, o.valor_planejado, o.valor_real, c.id, c.nome, c.tipo;

CREATE OR REPLACE VIEW vw_progresso_metas AS
SELECT
    m.id AS id_meta,
    m.id_usuario,
    m.nome       AS meta_nome,
    m.valor_objetivo,
    m.valor_atual,
    ROUND((m.valor_atual / NULLIF(m.valor_objetivo, 0)) * 100, 2) AS pct_concluido,
    m.data_limite,
    (m.data_limite - CURRENT_DATE) AS dias_restantes,
    m.status,
    CASE
        WHEN m.valor_atual >= m.valor_objetivo THEN 'concluida'
        WHEN m.data_limite < CURRENT_DATE      THEN 'atrasada'
        WHEN (m.data_limite - CURRENT_DATE) <= 30 THEN 'proximidade'
        ELSE 'em_andamento'
    END AS situacao
FROM metas m WHERE m.status = 'ativa';

CREATE OR REPLACE VIEW vw_historico_comparativo AS
SELECT
    o.id_usuario, o.ano, o.mes,
    TO_DATE(o.ano::TEXT || '-' || LPAD(o.mes::TEXT, 2, '0') || '-01', 'YYYY-MM-DD') AS data_referencia,
    o.valor_planejado, o.valor_real,
    o.valor_real - o.valor_planejado AS desvio,
    ROUND((o.valor_real / NULLIF(o.valor_planejado, 0)) * 100 - 100, 2) AS pct_desvio,
    LAG(o.valor_real) OVER (PARTITION BY o.id_usuario ORDER BY o.ano, o.mes) AS valor_real_mes_anterior,
    ROUND((o.valor_real / NULLIF(LAG(o.valor_real) OVER (PARTITION BY o.id_usuario ORDER BY o.ano, o.mes), 0) - 1) * 100, 2) AS pct_variacao_mom
FROM orcamento o
ORDER BY o.id_usuario, o.ano DESC, o.mes DESC;

-- =============================================================================
--  FIM DA MIGRATION
-- =============================================================================