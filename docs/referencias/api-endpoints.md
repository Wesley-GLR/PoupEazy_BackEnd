# Referencia: Endpoints da API

Base URL: `http://localhost:3001/api` (local) | `https://poupeazy-backend.onrender.com/api` (producao)

Todas as rotas protegidas exigem o header `Authorization: Bearer <token>`.

---

## Autenticacao (`/api/auth`)

### `POST /auth/register`

Cria usuario e profile em uma unica transacao.

**Body:**
```json
{
  "email": "string (obrigatorio)",
  "password": "string (obrigatorio, min 6 caracteres)",
  "nome": "string (opcional)",
  "telefone": "string (opcional)"
}
```

**Resposta `201`:**
```json
{
  "token": "jwt-string",
  "user": { "id": "uuid", "email": "string", "criado_em": "timestamp" },
  "profile": { "id": "uuid", "nome": "string", "telefone": "string|null", "criado_em": "timestamp", "atualizado_em": "timestamp" }
}
```

**Erros:** `400` campos ausentes ou senha curta | `409` email ja cadastrado

---

### `POST /auth/login`

**Body:**
```json
{
  "email": "string (obrigatorio)",
  "password": "string (obrigatorio)"
}
```

**Resposta `200`:** mesmo formato do register (`{ token, user, profile }`)

**Erros:** `400` campos ausentes | `401` credenciais invalidas

---

### `GET /auth/me` (protegida)

Retorna o usuario e profile da sessao atual.

**Resposta `200`:**
```json
{
  "user": { "id": "uuid", "email": "string", "criado_em": "timestamp" },
  "profile": { "id": "uuid", "nome": "string", "telefone": "string|null", ... }
}
```

---

### `POST /auth/forgot-password`

Gera token de reset valido por 1 hora.

**Body:**
```json
{ "email": "string (obrigatorio)" }
```

**Resposta `200`:**
```json
{
  "message": "Se o e-mail existir, um link de recuperacao foi gerado.",
  "resetToken": "string (apenas em NODE_ENV=development)"
}
```

---

### `POST /auth/reset-password`

Redefine a senha usando o token de reset.

**Body:**
```json
{
  "token": "string (obrigatorio)",
  "novaSenha": "string (obrigatorio, min 6 caracteres)"
}
```

**Resposta `200`:**
```json
{ "message": "Senha atualizada com sucesso." }
```

**Erros:** `400` campos ausentes, senha curta ou token invalido/expirado

---

### `PATCH /auth/password` (protegida)

Troca a senha do usuario autenticado.

**Body:**
```json
{ "novaSenha": "string (obrigatorio, min 6 caracteres)" }
```

**Resposta `200`:**
```json
{ "message": "Senha atualizada com sucesso." }
```

---

## Profile (`/api/profile`) — protegidas

### `GET /profile`

Retorna os dados do profile do usuario autenticado.

**Resposta `200`:**
```json
{
  "id": "uuid",
  "nome": "string",
  "telefone": "string|null",
  "criado_em": "timestamp",
  "atualizado_em": "timestamp"
}
```

---

### `PATCH /profile`

Atualiza campos do profile. Campos omitidos nao sao alterados.

**Body:**
```json
{
  "nome": "string (opcional)",
  "telefone": "string (opcional)"
}
```

**Resposta `200`:** profile atualizado

---

## Metas (`/api/metas`) — protegidas

### `GET /metas`

Lista todas as metas do usuario, ordenadas por `data_limite ASC`.

**Resposta `200`:** `[{ id, id_usuario, nome, descricao, valor_objetivo, valor_atual, data_limite, status, criado_em }, ...]`

---

### `POST /metas`

**Body:**
```json
{
  "nome": "string (obrigatorio)",
  "descricao": "string (opcional)",
  "valor_objetivo": "number (opcional, default 0)",
  "data_limite": "YYYY-MM-DD (obrigatorio)",
  "status": "ativa|concluida|cancelada (opcional, default ativa)"
}
```

**Resposta `201`:** meta criada

**Erros:** `400` campos obrigatorios ausentes

---

### `PATCH /metas/:id`

Atualiza campos da meta. Campos omitidos nao sao alterados.

**Body:** mesmos campos do POST, todos opcionais.

**Resposta `200`:** meta atualizada

**Erros:** `404` meta nao encontrada

---

### `DELETE /metas/:id`

**Resposta `204`:** sem corpo

**Erros:** `404` meta nao encontrada

---

## Orcamentos (`/api/orcamentos`) — protegidas

### `GET /orcamentos`

Lista orcamentos do usuario, ordenados por `ano DESC, mes DESC`.

**Resposta `200`:** `[{ id, id_usuario, mes, ano, valor_planejado, valor_real, criado_em, atualizado_em }, ...]`

---

### `POST /orcamentos`

**Body:**
```json
{
  "mes": "number 1-12 (obrigatorio)",
  "ano": "number 2000-2100 (obrigatorio)",
  "valor_planejado": "number (opcional, default 0)"
}
```

**Resposta `201`:** orcamento criado

**Erros:** `400` campos ausentes | `409` orcamento ja existe para esse mes/ano

---

### `POST /orcamentos/get-or-create`

Upsert: retorna o orcamento existente ou cria um novo.

**Body:** mesmo do POST

**Resposta `200`:** orcamento existente ou recem-criado

---

### `PATCH /orcamentos/:id`

**Body:**
```json
{
  "valor_planejado": "number (opcional)",
  "mes": "number (opcional)",
  "ano": "number (opcional)"
}
```

**Resposta `200`:** orcamento atualizado

**Erros:** `404` orcamento nao encontrado

---

## Categorias (`/api/categorias`) — protegidas

### `GET /categorias`

Lista categorias do sistema (`sistema = true`) + personalizadas do usuario, ordenadas por nome.

**Resposta `200`:** `[{ id, id_usuario, nome, tipo, icone, sistema }, ...]`

Tipos possiveis: `despesa_fixa`, `despesa_variavel`, `receita`.

---

### `POST /categorias`

Cria uma categoria personalizada.

**Body:**
```json
{
  "nome": "string (obrigatorio)",
  "tipo": "despesa_fixa|despesa_variavel|receita (obrigatorio)",
  "icone": "string (opcional)"
}
```

**Resposta `201`:** categoria criada (com `sistema = false`)

---

### `PATCH /categorias/:id`

Atualiza categoria personalizada. Categorias do sistema nao podem ser editadas.

**Body:** mesmos campos do POST, todos opcionais.

**Resposta `200`:** categoria atualizada

**Erros:** `404` categoria nao encontrada ou protegida

---

### `DELETE /categorias/:id`

Remove categoria personalizada. Categorias do sistema sao protegidas por trigger.

**Resposta `204`:** sem corpo

**Erros:** `404` categoria nao encontrada ou protegida

---

## Despesas/Transacoes (`/api/despesas`) — protegidas

### `GET /despesas`

Lista transacoes do usuario com a categoria aninhada, ordenadas por `data_transacao DESC`.

**Resposta `200`:**
```json
[
  {
    "id": "uuid",
    "id_orcamento": "uuid",
    "id_categoria": "uuid",
    "id_metas": "uuid|null",
    "valor": 150.00,
    "data_transacao": "2026-06-28",
    "descricao": "Supermercado",
    "tipo": "despesa",
    "origem": "manual",
    "status": "confirmada",
    "nlp_metadata": null,
    "criado_em": "timestamp",
    "categoria": { "id": "uuid", "nome": "Alimentacao", "tipo": "despesa_variavel", ... }
  }
]
```

---

### `POST /despesas`

**Body:**
```json
{
  "id_orcamento": "uuid (obrigatorio)",
  "id_categoria": "uuid (obrigatorio)",
  "id_metas": "uuid (opcional)",
  "valor": "number > 0 (obrigatorio)",
  "data_transacao": "YYYY-MM-DD (obrigatorio)",
  "descricao": "string (obrigatorio)",
  "tipo": "despesa|receita (obrigatorio)",
  "origem": "manual|open_finance|chatbot (opcional, default manual)",
  "status": "pendente|confirmada|cancelada (opcional, default confirmada)",
  "nlp_metadata": "object (opcional)"
}
```

**Resposta `201`:** transacao criada

**Erros:** `400` campos ausentes | `403` orcamento nao pertence ao usuario

---

### `PATCH /despesas/:id`

**Body:** mesmos campos do POST, todos opcionais.

**Resposta `200`:** transacao atualizada

**Erros:** `403` orcamento nao pertence ao usuario | `404` transacao nao encontrada

---

### `DELETE /despesas/:id`

**Resposta `204`:** sem corpo

**Erros:** `404` transacao nao encontrada

---

## Notificacoes (`/api/notificacoes`) — protegidas

### `GET /notificacoes`

Lista notificacoes do usuario, ordenadas por `criado_em DESC`.

**Resposta `200`:** `[{ id, id_usuario, tipo, titulo, mensagem, lida, criado_em }, ...]`

Tipos: `alerta_limite`, `meta_proxima`, `meta_concluida`, `dica`, `relatorio`.

---

### `PATCH /notificacoes/:id`

Marca como lida ou nao lida.

**Body:**
```json
{ "lida": true }
```

**Resposta `200`:** notificacao atualizada

---

### `DELETE /notificacoes/:id`

**Resposta `204`:** sem corpo

---

## Integracoes Open Finance (`/api/integracoes`) — protegidas

### `GET /integracoes`

Lista conexoes bancarias ativas (`ativo = true`).

**Resposta `200`:** `[{ id, id_usuario, instituicao, access_token_enc, expira_em, ativo, criado_em }, ...]`

---

### `POST /integracoes`

Conecta (ou reconecta) uma instituicao bancaria.

**Body:**
```json
{
  "instituicao": "string (obrigatorio)",
  "itemId": "string (obrigatorio)"
}
```

**Resposta `201`:** conexao criada/atualizada (upsert por usuario + instituicao)

---

### `DELETE /integracoes/:id`

Desconecta o banco (marca `ativo = false`, nao deleta).

**Resposta `204`:** sem corpo

---

## Pluggy (`/api/pluggy`) — protegidas

### `GET /pluggy/token`

Gera um connect token temporario para abrir o Widget da Pluggy no frontend.

**Resposta `200`:**
```json
{ "connectToken": "string" }
```

**Erros:** `500` credenciais Pluggy nao configuradas

---

### `GET /pluggy/transactions/:itemId`

Retorna o extrato normalizado da conta conectada.

**Resposta `200`:**
```json
{
  "transactions": [
    { "descricao": "string", "valor": 100.00, "tipo": "receita|despesa", "data": "YYYY-MM-DD" }
  ]
}
```

---

## Relatorios (`/api/relatorios`) — protegidas

### `GET /relatorios/resumo-mensal`

Dados da view `vw_resumo_mensal`: gastos por categoria em cada mes.

**Resposta `200`:** `[{ id_usuario, usuario_nome, ano, mes, categoria_nome, categoria_tipo, total_gasto, qtd_transacoes, valor_planejado, valor_real, pct_orcamento_consumido }, ...]`

---

### `GET /relatorios/progresso-metas`

Dados da view `vw_progresso_metas`: progresso de cada meta ativa.

**Resposta `200`:** `[{ id_meta, id_usuario, meta_nome, valor_objetivo, valor_atual, pct_concluido, data_limite, dias_restantes, status, situacao }, ...]`

Situacoes possiveis: `concluida`, `atrasada`, `proximidade`, `em_andamento`.

---

### `GET /relatorios/historico`

Dados da view `vw_historico_comparativo`: orcamento planejado vs real ao longo dos meses.

**Resposta `200`:** `[{ id_usuario, ano, mes, data_referencia, valor_planejado, valor_real, desvio, pct_desvio, valor_real_mes_anterior, pct_variacao_mom }, ...]`

---

## Healthcheck (publico)

### `GET /health`

**Resposta `200`:**
```json
{ "status": "ok", "env": "development|production", "time": "ISO-timestamp" }
```
