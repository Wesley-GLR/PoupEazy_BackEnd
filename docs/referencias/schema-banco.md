# Referencia: Schema do banco de dados

O schema completo esta em `db/schema.sql`. Este documento descreve cada tabela, seus campos, relacionamentos, triggers e views.

---

## Diagrama de relacionamentos

```
usuarios (1) ---- (1) profiles
                        |
            +-----------+-----------+-------------------+
            |           |           |                   |
         metas      orcamento   open_finance_tokens  notificacoes
                        |
                    despesas ---- categoria
```

---

## Extensoes

| Extensao | Uso |
|----------|-----|
| `pgcrypto` | `gen_random_uuid()` para gerar UUIDs nas chaves primarias |
| `pg_trgm` | Indice GIN trigram em `despesas.descricao` para busca por similaridade |

---

## Tabelas

### `usuarios`

Credenciais de autenticacao. Substitui o `auth.users` do Supabase.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK, default `gen_random_uuid()` | Identificador unico |
| `email` | VARCHAR(255) | NOT NULL, UNIQUE | Email do usuario |
| `senha_hash` | TEXT | NOT NULL | Hash bcrypt da senha |
| `reset_token` | TEXT | | Token de recuperacao de senha |
| `reset_expira_em` | TIMESTAMPTZ | | Validade do token de reset |
| `criado_em` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Data de criacao |

---

### `profiles`

Dados complementares do usuario (relacao 1:1 com `usuarios`).

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK, FK -> `usuarios(id)` ON DELETE CASCADE | Mesmo ID do usuario |
| `nome` | VARCHAR(150) | NOT NULL, default `''` | Nome do usuario |
| `telefone` | VARCHAR(20) | | Telefone |
| `criado_em` | TIMESTAMPTZ | NOT NULL, default `NOW()` | |
| `atualizado_em` | TIMESTAMPTZ | NOT NULL, default `NOW()` | Atualizado automaticamente por trigger |

---

### `metas`

Metas financeiras.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_usuario` | UUID | FK -> `profiles(id)` ON DELETE CASCADE | Dono da meta |
| `nome` | VARCHAR(100) | NOT NULL | Nome da meta |
| `descricao` | TEXT | | Descricao opcional |
| `valor_objetivo` | DECIMAL(12,2) | NOT NULL, default 0, CHECK > 0 | Valor alvo |
| `valor_atual` | DECIMAL(12,2) | NOT NULL, default 0 | Calculado automaticamente por trigger |
| `data_limite` | DATE | NOT NULL | Prazo da meta |
| `status` | VARCHAR(20) | NOT NULL, default `'ativa'`, CHECK IN (`ativa`, `concluida`, `cancelada`) | |
| `criado_em` | TIMESTAMPTZ | NOT NULL | |

---

### `orcamento`

Orcamento mensal.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_usuario` | UUID | FK -> `profiles(id)` ON DELETE CASCADE | |
| `mes` | INT | NOT NULL, CHECK 1-12 | Mes de referencia |
| `ano` | INT | NOT NULL, CHECK 2000-2100 | Ano de referencia |
| `valor_planejado` | DECIMAL(12,2) | NOT NULL, default 0, CHECK >= 0 | Quanto o usuario planeja gastar |
| `valor_real` | DECIMAL(12,2) | NOT NULL, default 0 | Calculado automaticamente por trigger |
| `criado_em` | TIMESTAMPTZ | NOT NULL | |
| `atualizado_em` | TIMESTAMPTZ | NOT NULL | Atualizado automaticamente por trigger |

**Constraint UNIQUE:** `(id_usuario, mes, ano)` — um orcamento por mes/ano por usuario.

---

### `categoria`

Categorias de transacao. Podem ser do sistema (nativas) ou personalizadas do usuario.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_usuario` | UUID | FK -> `profiles(id)`, nullable | NULL = categoria do sistema |
| `nome` | VARCHAR(100) | NOT NULL | |
| `tipo` | VARCHAR(20) | NOT NULL, CHECK IN (`despesa_fixa`, `despesa_variavel`, `receita`) | |
| `icone` | VARCHAR(50) | | Nome do icone (Lucide) |
| `sistema` | BOOLEAN | NOT NULL, default FALSE | Categorias do sistema nao podem ser deletadas |

**Constraint UNIQUE:** `(nome, tipo, id_usuario)`

**Categorias padrao (seed):**

| Nome | Tipo | Icone |
|------|------|-------|
| Alimentacao | despesa_variavel | utensils |
| Transporte | despesa_variavel | car |
| Moradia | despesa_fixa | home |
| Saude | despesa_variavel | heart-pulse |
| Lazer | despesa_variavel | music |
| Educacao | despesa_variavel | book-open |
| Assinaturas | despesa_fixa | repeat |
| Outros | despesa_variavel | ellipsis |
| Salario | receita | briefcase |
| Freelance | receita | zap |
| Investimentos | receita | trending-up |

---

### `despesas`

Transacoes financeiras (tanto despesas quanto receitas).

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_orcamento` | UUID | FK -> `orcamento(id)` ON DELETE RESTRICT | Orcamento ao qual pertence |
| `id_categoria` | UUID | FK -> `categoria(id)` ON DELETE RESTRICT | Categoria da transacao |
| `id_metas` | UUID | FK -> `metas(id)` ON DELETE SET NULL | Meta vinculada (opcional) |
| `valor` | DECIMAL(12,2) | NOT NULL, CHECK > 0 | Valor sempre positivo |
| `data_transacao` | DATE | NOT NULL | Data da transacao |
| `descricao` | VARCHAR(255) | NOT NULL | Descricao da transacao |
| `tipo` | VARCHAR(20) | NOT NULL, CHECK IN (`despesa`, `receita`) | |
| `origem` | VARCHAR(20) | NOT NULL, default `'manual'`, CHECK IN (`manual`, `open_finance`, `chatbot`) | De onde veio |
| `status` | VARCHAR(20) | NOT NULL, default `'confirmada'`, CHECK IN (`pendente`, `confirmada`, `cancelada`) | |
| `nlp_metadata` | JSONB | | Metadados de processamento de linguagem natural |
| `criado_em` | TIMESTAMPTZ | NOT NULL | |

---

### `open_finance_tokens`

Conexoes com instituicoes financeiras via Pluggy.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_usuario` | UUID | FK -> `profiles(id)` ON DELETE CASCADE | |
| `instituicao` | VARCHAR(100) | NOT NULL | Nome da instituicao |
| `access_token_enc` | TEXT | NOT NULL | ItemId da Pluggy |
| `refresh_token_enc` | TEXT | | Nao utilizado atualmente |
| `expira_em` | TIMESTAMPTZ | NOT NULL | Validade da conexao (30 dias) |
| `ultimo_uso` | TIMESTAMPTZ | | |
| `ativo` | BOOLEAN | NOT NULL, default TRUE | Soft delete |
| `criado_em` | TIMESTAMPTZ | NOT NULL | |

**Constraint UNIQUE:** `(id_usuario, instituicao)` — uma conexao por banco por usuario (upsert).

---

### `notificacoes`

Alertas e notificacoes.

| Coluna | Tipo | Restricoes | Descricao |
|--------|------|------------|-----------|
| `id` | UUID | PK | |
| `id_usuario` | UUID | FK -> `profiles(id)` ON DELETE CASCADE | |
| `tipo` | VARCHAR(30) | NOT NULL, CHECK IN (`alerta_limite`, `meta_proxima`, `meta_concluida`, `dica`, `relatorio`) | |
| `titulo` | VARCHAR(200) | NOT NULL | |
| `mensagem` | TEXT | NOT NULL | |
| `lida` | BOOLEAN | NOT NULL, default FALSE | |
| `criado_em` | TIMESTAMPTZ | NOT NULL | |

---

## Triggers

### `trg_profiles_atualizado_em` / `trg_orcamento_atualizado_em`

Atualiza a coluna `atualizado_em` com `NOW()` antes de cada `UPDATE` nas tabelas `profiles` e `orcamento`.

### `trg_orcamento_valor_real`

Dispara apos `INSERT`, `UPDATE` ou `DELETE` na tabela `despesas`. Recalcula o `valor_real` do orcamento somando despesas confirmadas e subtraindo receitas confirmadas.

### `trg_metas_valor_atual`

Dispara apos `INSERT`, `UPDATE` ou `DELETE` na tabela `despesas`. Recalcula o `valor_atual` da meta vinculada somando despesas confirmadas do tipo `'despesa'`.

### `trg_protege_categoria_sistema`

Dispara antes de `DELETE` na tabela `categoria`. Impede a exclusao de categorias com `sistema = TRUE`, lancando um erro PostgreSQL.

---

## Indices

| Indice | Tabela | Colunas | Tipo |
|--------|--------|---------|------|
| `idx_despesas_orcamento` | despesas | `(id_orcamento, data_transacao DESC)` | B-tree |
| `idx_despesas_categoria` | despesas | `(id_categoria, data_transacao DESC)` | B-tree |
| `idx_despesas_metas` | despesas | `(id_metas)` WHERE id_metas IS NOT NULL | B-tree parcial |
| `idx_despesas_origem` | despesas | `(origem, status)` | B-tree |
| `idx_despesas_descricao` | despesas | `(descricao)` | GIN trigram |
| `idx_despesas_nlp` | despesas | `(nlp_metadata)` | GIN JSONB |
| `idx_orcamento_usuario` | orcamento | `(id_usuario, ano DESC, mes DESC)` | B-tree |
| `idx_metas_usuario` | metas | `(id_usuario, status, data_limite ASC)` | B-tree |
| `idx_tokens_usuario` | open_finance_tokens | `(id_usuario, ativo)` WHERE ativo = TRUE | B-tree parcial |
| `idx_notificacoes_usuario` | notificacoes | `(id_usuario, lida, criado_em DESC)` | B-tree |

---

## Views

### `vw_resumo_mensal`

Gastos agrupados por categoria em cada mes. Inclui percentual do orcamento consumido.

### `vw_progresso_metas`

Progresso de cada meta ativa: percentual concluido, dias restantes e situacao (`concluida`, `atrasada`, `proximidade`, `em_andamento`).

### `vw_historico_comparativo`

Orcamento planejado vs real mes a mes, com desvio absoluto, percentual, e variacao mês a mês (MoM) via `LAG()`.
