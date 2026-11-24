-- =============================================================================
--  RESET - apaga TODAS as tabelas/views do PoupEazy.
--  ATENCAO: destrutivo. Use apenas em desenvolvimento para recomecar do zero.
--  Depois de rodar este script, execute db/schema.sql novamente.
-- =============================================================================
DROP VIEW IF EXISTS vw_historico_comparativo CASCADE;
DROP VIEW IF EXISTS vw_progresso_metas CASCADE;
DROP VIEW IF EXISTS vw_resumo_mensal CASCADE;

DROP TABLE IF EXISTS whatsapp_mensagens;
DROP TABLE IF EXISTS whatsapp_codigos;
DROP TABLE IF EXISTS whatsapp_vinculos;
DROP TABLE IF EXISTS notificacoes CASCADE;
DROP TABLE IF EXISTS open_finance_tokens CASCADE;
DROP TABLE IF EXISTS despesas CASCADE;
DROP TABLE IF EXISTS categoria CASCADE;
DROP TABLE IF EXISTS orcamento CASCADE;
DROP TABLE IF EXISTS metas CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;

DROP FUNCTION IF EXISTS fn_set_atualizado_em() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_orcamento_valor_real() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_metas_valor_atual() CASCADE;
DROP FUNCTION IF EXISTS fn_protege_categoria_sistema() CASCADE;
