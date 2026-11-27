# PoupEazy Backend

Backend proprio do PoupEazy que substitui o Supabase (autenticacao + banco de dados)
e ja incorpora a integracao Open Finance (Pluggy).

Stack: **Node.js + Express + PostgreSQL + JWT**.

O RF02 permite vincular a conta ao WhatsApp, registrar despesas após confirmação e consultar relatórios. Consulte o [guia de configuração e demonstração do WhatsApp](WHATSAPP_DEMO.md).

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

### 2.5 Gmail API: envio de e-mail e recuperacao de senha

O transporte de e-mail usa OAuth e a Gmail API por HTTPS. Ha um comando local
para enviar uma mensagem fixa de teste e um fluxo de recuperacao de senha.
Cadastro/confirmacao, notificacoes e relatorios ainda nao disparam e-mails.
O envio fica desabilitado por padrao.

1. Na Google Cloud, habilite a Gmail API no projeto do cliente OAuth. O refresh
   token deve ter sido autorizado pela conta `poupeazy@gmail.com`, com o escopo
   `https://www.googleapis.com/auth/gmail.send`, usando o mesmo Client ID e
   Client Secret configurados aqui.
2. No `.env` privado da pasta do backend, configure:

   ```dotenv
   EMAIL_ENABLED=true
   EMAIL_FROM=poupeazy@gmail.com
   GMAIL_CLIENT_ID=preencha_localmente
   GMAIL_CLIENT_SECRET=preencha_localmente
   GMAIL_REFRESH_TOKEN=preencha_localmente
   GMAIL_TEST_RECIPIENT=poupeazy@gmail.com
   PASSWORD_RESET_URL=https://poup-eazy.vercel.app/redefinir-senha
   ```

   `GMAIL_TEST_RECIPIENT` aceita um unico e-mail. Se ficar vazio, o teste envia
   para a propria conta do projeto. O servidor renova o access token a partir
   do refresh token; nao configure um access token manual ou uma redirect URI
   no servidor para essa renovacao. Mantenha esses valores somente no backend.
3. Com as dependencias instaladas, rode localmente:

   ```bash
   npm run email:test
   ```

   Esse comando nao depende de PostgreSQL, da API em execucao ou de login no
   app. Ele nao aceita argumentos para alterar destinatario ou mensagem.
   Sucesso indica que o Gmail aceitou o envio; confira caixa de entrada, spam
   e a pasta Enviados. Isso nao confirma entrega ao destinatario. Se o comando
   informar resultado incerto, confira Enviados antes de repetir para evitar
   mensagens duplicadas. Nao ha reenvio automatico do POST de envio.
4. Depois de validar localmente, no Render abra o servico da API, **Environment**,
   e cadastre as mesmas variaveis como valores privados. Salve e faca deploy da
   versao com o transporte. Nao coloque segredos em `render.yaml`, no Git ou
   nas variaveis `VITE_*`/`EXPO_PUBLIC_*`. O Render Free nao oferece Shell/SSH e
   bloqueia portas SMTP; por isso o teste desta etapa e local e o transporte
   usa HTTPS. Consulte as [limitacoes oficiais do Render Free](https://render.com/docs/free#other-limitations).

Os arquivos `.env` e os nomes comuns de arquivos OAuth baixados estao no
`.gitignore`; isso nao remove arquivos que ja tenham sido versionados. Nunca
cole credenciais em logs ou mensagens. Se ocorrer erro de autorizacao, confira
o cliente OAuth, a conta conectada, o escopo e a ativacao da Gmail API, sem
expor os tokens para diagnostico.

Em projetos OAuth com publico **External** e status **Testing**, refresh tokens
com escopos do Gmail expiram em sete dias. Reconecte a conta quando necessario.
Mudar o status do projeto nao substitui a validacao da configuracao, dos escopos
e das exigencias aplicaveis para uso continuo. Veja a [documentacao de expiracao
de refresh tokens do Google](https://developers.google.com/identity/protocols/oauth2#expiration).

### 2.6 Recuperacao de senha

`POST /api/auth/forgot-password` recebe `{ "email": "usuario@example.com" }`.
Com envio habilitado, a resposta 200 tem somente `message`, igual para conta
existente, inexistente, pedido em cooldown ou falha no transporte. Tokens nunca
sao devolvidos pela API, inclusive em desenvolvimento. Quando o envio esta
desabilitado, todas as contas recebem 503 com `code: "EMAIL_DISABLED"`, sem
consulta de existencia. Indisponibilidade do banco retorna 503 com
`code: "RESET_UNAVAILABLE"`.

O link e montado apenas a partir de `PASSWORD_RESET_URL`, sem usar o Host da
requisicao. O padrao e `https://poup-eazy.vercel.app/redefinir-senha`; a URL deve
usar HTTPS, sem credenciais, query ou fragmento. HTTP e permitido somente para
loopback (`localhost`, `127.0.0.1`, `::1`) em development/test. Para validar tudo
localmente, configure `PASSWORD_RESET_URL=http://localhost:5173/redefinir-senha`
no backend e `VITE_API_URL=http://localhost:3001/api` no frontend, iniciando ambos.
Um link emitido pelo banco local deve ser aberto no frontend local, que chama
a API local; o site publicado consulta outra base e nao reconheceria esse token.

O token aleatorio de 32 bytes aparece apenas no link do e-mail. O banco guarda
seu SHA-256 em `reset_token`, com validade de uma hora em `reset_expira_em`.
Um UPDATE condicional limita a emissao a uma vez a cada 60 segundos por conta,
inclusive entre IPs ou processos diferentes; um novo link substitui o anterior.
O consumo tambem usa um UPDATE atomico que verifica a validade e apaga o token:
dois pedidos concorrentes de reset produzem no maximo um sucesso. Links antigos
emitidos no formato em texto puro deixam de funcionar; solicite outro link.
As colunas existentes sao reutilizadas, sem migracao de esquema nesta etapa.

`POST /api/auth/reset-password` recebe `{ "token": "64-caracteres-hex", "novaSenha": "nova senha" }`.
Token malformado, expirado, substituido ou ja utilizado retorna 400 com
`code: "RESET_TOKEN_INVALID"`; senha invalida retorna 422. Sucesso retorna
somente uma mensagem, sem autenticar automaticamente. Faca login com a nova
senha. A alteracao autenticada tambem apaga links pendentes.

Os JWTs novos incluem um marcador HMAC vinculado ao hash da senha. Exclusao,
troca ou reset de senha invalidam as sessoes anteriores. No primeiro deploy
desta mudanca, os JWTs antigos sem marcador serao recusados e os usuarios
precisarao fazer login novamente.

O envio comeca depois da resposta HTTP para que a latencia do Gmail nao revele
quais contas existem. Ainda nao ha fila duravel: um reinicio entre a resposta
e o envio pode perder a tentativa. Se o e-mail nao chegar, confira spam e faca
outro pedido depois de pelo menos 60 segundos. Falhas e resultado incerto nao
limpam o cooldown e nao geram retry automatico, pois a entrega pode ter ocorrido.
Os logs registram apenas codigos controlados, sem endereco, token, link ou
excecao bruta. Essa limitacao de durabilidade deve ser resolvida antes de exigir
garantia de entrega em producao.

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
| POST | `/auth/delete-account` | Publico: reautentica `{ email, password, confirmacao: "EXCLUIR" }` e exclui a conta e dados locais associados |
| GET  | `/auth/me` | Usuario + profile da sessao atual |
| POST | `/auth/forgot-password` | Solicita link por e-mail; resposta generica sem token e cooldown de 60s |
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
| GET / POST / DELETE | `/whatsapp/vinculo` | Consulta, gera código de vínculo ou desvincula o WhatsApp da conta autenticada |
| GET | `/relatorios/resumo-mensal` | View `vw_resumo_mensal` |
| GET | `/relatorios/progresso-metas` | View `vw_progresso_metas` |
| GET | `/relatorios/historico` | View `vw_historico_comparativo` |

> Recuperacao de senha: use o link enviado por e-mail, que abre a pagina
> `/redefinir-senha?token=...`. Nunca copie hashes do banco para o frontend.

### Exclusao de conta

`POST /api/auth/delete-account` permite solicitar exclusao pela pagina publica
do site, sem depender de uma sessao no app. Exige e-mail, senha atual e
`confirmacao: "EXCLUIR"`; o limite de tentativas das rotas de autenticacao tambem
se aplica. E-mail inexistente e senha incorreta recebem a mesma resposta 401.
Sucesso retorna 200 com `{ "message": "Conta e dados associados excluidos da base ativa do PoupEazy." }`.

A exclusao ocorre em uma unica transacao: transacoes financeiras, notificacoes,
mensagens vinculadas/codigos/vinculo WhatsApp, integracoes locais Open Finance,
metas, categorias pessoais, orcamentos, perfil e credenciais. Categorias do
sistema e dados de outras contas sao preservados. Tokens JWT antigos deixam de
ser aceitos porque toda rota protegida verifica se a conta ainda existe.
Tabelas opcionais do WhatsApp sao verificadas antes da limpeza, permitindo
tambem excluir contas em bancos anteriores a migration `005_whatsapp.sql`.

O endpoint remove os dados da base ativa do PoupEazy. Nao exclui mensagens ja
entregues no WhatsApp nem dados mantidos por provedores e bancos. No contrato
atual, `open_finance_tokens.access_token_enc` guarda um itemId da Pluggy; nao
fazemos exclusao remota por esse ID sem validar a propriedade no provedor.
Revogacao externa, retencao de backups e registros de infraestrutura exigem
procedimentos e prazos definidos antes de prometer exclusao integral. Ainda nao
ha fila de e-mails ou relatorios persistidos para apagar; ao adicionar essas
funcionalidades, sua limpeza deve entrar na mesma politica de exclusao.

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
O script `npm test` carrega `test-support/safe-env.js` antes dos testes: o envio
Gmail fica desabilitado, as credenciais de e-mail sao apagadas do ambiente do
processo e `dotenv.config()` nao le o `.env` privado. Os testes de recuperacao
injetam `sendEmail` falso via `createApp`, capturam o link em memoria e nunca
enviam mensagens reais. A suite PostgreSQL continua opt-in e usa uma base
descartavel de loopback; ela verifica cooldown e consumo concorrentes no banco.

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
