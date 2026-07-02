# Autorizacao por dono (owner-based authorization)

## O problema

Em uma aplicacao multi-usuario, cada usuario so deve ver e manipular seus proprios dados. Se o usuario A cria uma meta, o usuario B nao pode ve-la, edita-la ou deleta-la.

## Como o Supabase resolvia

O Supabase usava **Row Level Security (RLS)**, um recurso nativo do PostgreSQL que aplica filtros automaticamente no nivel do banco:

```sql
-- Politica RLS no Supabase
CREATE POLICY "Usuarios veem apenas suas metas"
  ON metas FOR SELECT
  USING (id_usuario = auth.uid());
```

Com RLS, qualquer query `SELECT * FROM metas` ja retornava apenas as metas do usuario logado, sem precisar de filtro explicito.

## Como o PoupEazy resolve agora

Sem o Supabase Auth, nao ha `auth.uid()` disponivel no banco. A autorizacao foi movida para a **camada da aplicacao**:

### 1. O middleware extrai o usuario do token

```javascript
// src/middleware/auth.js
const payload = jwt.verify(token, config.jwtSecret);
req.userId = payload.sub;
```

### 2. Cada query filtra por `id_usuario`

```javascript
// src/routes/metas.routes.js
const { rows } = await db.query(
  'SELECT * FROM metas WHERE id_usuario = $1',
  [req.userId]
);
```

### 3. Operacoes de escrita tambem validam

```javascript
// DELETE so funciona se a meta pertence ao usuario
'DELETE FROM metas WHERE id = $1 AND id_usuario = $2'
```

## Garantias

| Operacao | Protecao |
|----------|----------|
| Listar | `WHERE id_usuario = $1` |
| Criar | `INSERT ... VALUES ($userId, ...)` |
| Atualizar | `WHERE id = $1 AND id_usuario = $2` |
| Deletar | `WHERE id = $1 AND id_usuario = $2` |

Se o `id_usuario` nao bater, a query retorna zero linhas e a API responde `404` ("nao encontrado") — o usuario nem sabe que o recurso existe para outro usuario.

## Caso especial: despesas

Despesas nao tem `id_usuario` diretamente — pertencem a um `orcamento`, que por sua vez pertence a um usuario. A protecao e feita via JOIN ou subquery:

```sql
-- DELETE em despesas valida o dono via orcamento
DELETE FROM despesas
WHERE id = $1
  AND id_orcamento IN (SELECT id FROM orcamento WHERE id_usuario = $2)
```

Na criacao de despesas, uma funcao auxiliar (`orcamentoDoUsuario`) verifica se o orcamento informado pertence ao usuario antes de inserir.

## Trade-offs em relacao ao RLS

| Aspecto | RLS (Supabase) | Filtro na aplicacao (PoupEazy) |
|---------|:--------------:|:------------------------------:|
| Onde a regra vive | No banco | No codigo da rota |
| Risco de esquecer o filtro | Baixo (RLS e automatico) | Maior (precisa lembrar de incluir `WHERE id_usuario`) |
| Visibilidade | Politicas SQL (menos visiveis) | Codigo JavaScript (mais visivel) |
| Flexibilidade | Limitada ao que o RLS permite | Total (pode fazer logica complexa) |
| Performance | Filtro no planner do PostgreSQL | Filtro via parametro (similar) |

A escolha pelo filtro na aplicacao e adequada para o escopo do projeto. O padrao e consistente: **toda rota protegida recebe `req.userId` do middleware e o usa na query**. Ao seguir esse padrao, o risco de vazamento de dados e baixo.
