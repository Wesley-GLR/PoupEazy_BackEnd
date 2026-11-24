# PoupEazy Backend

Backend proprio do PoupEazy que substitui o Supabase (autenticacao + banco de dados)
e ja incorpora a integracao Open Finance (Pluggy).

Stack: **Node.js + Express + PostgreSQL + JWT**.

Para o RF02, consulte o [guia da demonstração do WhatsApp](WHATSAPP_DEMO.md).

- Autenticacao via JWT (bcrypt para hash de senha) no lugar do Supabase Auth.
- Autorizacao por dono: cada query filtra por `id_usuario` (substitui o RLS/`auth.uid()`).
- Mesmas tabelas, triggers e views do projeto original (adaptados em `db/schema.sql`).
- Rotas Pluggy reaproveitadas do backend antigo (`/api/pluggy/...`).
- Itens Pluggy vinculados ao dono, DTOs sem tokens e sincronizacao atomica/idempotente.
- Validacao de payloads, limite de corpo, headers seguros e rate limiting.

---

## 1. Pre-requisitos

- Node.js 20+
- Docker Desktop (para o PostgreSQL local)
- DBeaver (opcional, para inspecionar o banco)
- Postman (para testar a API)

---

## 2. Setup local (passo a passo)

### 2.1 Variaveis de ambiente

```bash
cp .env.example .env
```

Edite o `.env` se quiser. Os valores padrao ja funcionam com o Docker local. Preencha
`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` se for testar o Open Finance.

### 2.2 Subir o PostgreSQL (Docker)

```bash
docker compose up -d
```

Isso sobe um Postgres 16 em `localhost:5432` (usuario `poupeazy`, senha `poupeazy`,
banco `poupeazy`) e **aplica automaticamente** o `db/schema.sql` na primeira vez
(tabelas, triggers, views e as categorias do sistema).

> Para recriar o banco do zero: `docker compose down -v` e depois `docker compose up -d`.

### 2.3 Conectar no DBeaver (opcional)

- Host: `localhost` · Porta: `5432`
- Database: `poupeazy` · Usuario: `poupeazy` · Senha: `poupeazy`

Para reaplicar o schema manualmente, abra `db/schema.sql` no DBeaver e execute.
Para zerar tudo, rode `db/reset.sql` e depois `db/schema.sql`.

### 2.4 Instalar dependencias e rodar a API

```bash
npm install
npm run dev      # com reload automatico (nodemon)
# ou
npm start        # producao
```

A API sobe em `http://localhost:3001`. Teste o healthcheck:

```
GET http://localhost:3001/api/health
```

### Alternativa: rodar tudo no Docker

```bash
docker compose up -d --build
```

Sobe o banco **e** a API juntos. Lembre de exportar `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET`
no ambiente antes, se for usar a Pluggy.

---

## 3. Testar no Postman

1. Importe o arquivo `PoupEazy.postman_collection.json`.
2. A collection ja vem com as variaveis `baseUrl` (`http://localhost:3001/api`) e `token`.
3. Rode **Auth > Register** (ou **Login**): o script de teste salva o JWT na variavel
   `{{token}}` automaticamente, e todas as outras requisicoes ja usam esse token.
4. A partir dai, teste as demais pastas (Metas, Orcamentos, Categorias, Despesas, etc.).

### Mapa de endpoints

Base: `http://localhost:3001/api` — exceto auth publico, tudo exige
`Authorization: Bearer <token>`.

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET  | `/health` | Status da API (publico) |
| POST | `/auth/register` | Cria usuario + profile, retorna `{ token, user, profile }` |
| POST | `/auth/login` | Login, retorna `{ token, user, profile }` |
| GET  | `/auth/me` | Usuario + profile da sessao atual |
| POST | `/auth/forgot-password` | Gera token de reset (em DEV retorna `resetToken`) |
| POST | `/auth/reset-password` | Redefine senha com `{ token, novaSenha }` |
| PATCH| `/auth/password` | Troca a senha do usuario logado |
| GET  | `/profile` | Dados do profile |
| PATCH| `/profile` | Atualiza `nome` / `telefone` |
| GET / POST | `/metas` | Lista / cria meta |
| PATCH / DELETE | `/metas/:id` | Atualiza / remove meta |
| GET / POST | `/orcamentos` | Lista / cria orcamento |
| POST | `/orcamentos/get-or-create` | Upsert por `{ mes, ano }` |
| PATCH| `/orcamentos/:id` | Atualiza orcamento |
| GET / POST | `/categorias` | Lista (sistema + proprias) / cria |
| PATCH / DELETE | `/categorias/:id` | Atualiza / remove (so personalizadas) |
| GET / POST | `/despesas` | Lista (com categoria aninhada) / cria |
| PATCH / DELETE | `/despesas/:id` | Atualiza / remove transacao |
| GET | `/notificacoes` | Lista notificacoes |
| PATCH / DELETE | `/notificacoes/:id` | Marca lida / remove |
| GET / POST | `/integracoes` | Conexoes Open Finance ativas / conectar banco |
| DELETE | `/integracoes/:id` | Desconectar banco (ativo=false) |
| GET | `/pluggy/token` | Gera connect token da Pluggy |
| GET | `/pluggy/transactions/:itemId` | Contrato web legado; exige item pertencente ao usuario |
| POST | `/pluggy/sync/:integrationId` | Importa todas as contas/paginas de forma atomica e idempotente |
| GET | `/relatorios/resumo-mensal` | View `vw_resumo_mensal` |
| GET | `/relatorios/progresso-metas` | View `vw_progresso_metas` |
| GET | `/relatorios/historico` | View `vw_historico_comparativo` |

> Recuperacao de senha (modo dev): chame `POST /auth/forgot-password`, copie o
> `resetToken` da resposta e use em `POST /auth/reset-password`. No frontend, o link
> e `/redefinir-senha?token=SEU_TOKEN`.

### Banco existente

Antes de usar a sincronizacao mobile em um volume/banco criado anteriormente, aplique:

```powershell
Get-Content -Raw db\migrations\004_mobile_security_open_finance.sql |
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U poupeazy -d poupeazy
```

Essa migration adiciona o vinculo entre transacao e integracao e o indice de e-mail normalizado. Ela nao apaga transacoes existentes.

### Verificacoes automatizadas

```bash
npm test
npm run check
```

Os testes cobrem validacao de e-mail/data/UUID/valores, normalizacao de transacoes, filtros/paginacao, DTO seguro de integracoes e regras de normalizacao da Pluggy.

---

## 4. Conectar o frontend

No projeto do frontend (`PoupEazy/frontend`), configure o `.env`:

```
VITE_API_URL=http://localhost:3001/api
```

Depois rode `npm install` e `npm run dev`. O frontend ja consome este backend
(login/cadastro, dados e Open Finance) — o Supabase nao e mais utilizado.

---

## 5. Hospedagem em producao

O projeto esta hospedado e disponivel publicamente:

| Servico | Plataforma | URL |
|---------|------------|-----|
| Frontend | Vercel | [poup-eazy.vercel.app](https://poup-eazy.vercel.app) |
| API (Backend) | Render | [poupeazy-backend.onrender.com](https://poupeazy-backend.onrender.com) |
| Banco de dados | Neon (PostgreSQL) | _(acesso interno)_ |

Para testar a API diretamente:

```
GET https://poupeazy-backend.onrender.com/api/health
```

> Observacao: o plano free do Render hiberna apos um periodo sem uso — a primeira
> requisicao depois disso fica mais lenta (cold start).

### Variaveis de ambiente em producao

- **Render**: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `NODE_ENV=production` (e credenciais Pluggy, se aplicavel).
- **Vercel**: `VITE_API_URL=https://poupeazy-backend.onrender.com/api`.

---

## 6. Estrutura do projeto

```
PoupEazy_BackEnd/
├── docker-compose.yml      # Postgres (e API opcional via --profile api)
├── Dockerfile              # imagem da API
├── .env.example
├── db/
│   ├── schema.sql          # DDL + triggers + views + seed (sem RLS/auth do Supabase)
│   └── reset.sql           # apaga tudo (dev)
├── scripts/
│   └── init-db.js          # aplica o schema via `npm run db:init`
└── src/
    ├── app.js              # middlewares e montagem testavel das rotas
    ├── server.js           # inicializacao do servidor HTTP
    ├── db.js               # pool do PostgreSQL
    ├── config.js           # variaveis de ambiente
    ├── middleware/         # auth (JWT) + tratamento de erros
    ├── services/           # regras de transacoes e sincronizacao Pluggy
    ├── utils/              # validadores de entrada compartilhados
    └── routes/             # auth, profile, metas, orcamentos, categorias,
                            # despesas, notificacoes, integracoes, pluggy, relatorios
```
