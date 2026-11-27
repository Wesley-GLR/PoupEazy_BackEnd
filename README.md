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
para enviar uma mensagem fixa de teste, recuperacao de senha e confirmacao de cadastro.
Troca e reset de senha tambem enviam um aviso de seguranca apos o sucesso.
Alertas opcionais de orcamento, novos lancamentos, metas e relatorios solicitados pelo usuario tambem usam esse transporte.
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
   EMAIL_VERIFICATION_URL=https://poup-eazy.vercel.app/confirmar-email
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

### 2.7 Confirmacao de cadastro e ordem de atualizacao

**Antes de publicar esta versao do backend em um banco existente**, aplique
`db/migrations/007_email_verification.sql` no editor SQL do banco correto, com
os procedimentos habituais de backup da equipe. A migration acrescenta quatro
colunas e muda o padrao apenas para contas futuras; nao apaga dados. Nao basta
reexecutar `schema.sql`, pois `CREATE TABLE IF NOT EXISTS` nao altera tabelas
existentes. O arquivo pode ser reaplicado sem liberar contas pendentes.

A ordem e: aplicar a migration 007; configurar `EMAIL_ENABLED=true`, as
credenciais Gmail e `EMAIL_VERIFICATION_URL` no ambiente privado da API;
publicar backend e clientes compativeis com o novo retorno do cadastro.
O padrao da URL e `https://poup-eazy.vercel.app/confirmar-email`. Para testes
locais, use `http://localhost:5173/confirmar-email` e o frontend com
`VITE_API_URL=http://localhost:3001/api`. Valem as mesmas regras HTTPS e loopback
da URL de recuperacao. Nenhuma migration e executada automaticamente no startup.

Contas anteriores a migration mantem `email_verificacao_obrigatoria=false` e
`email_verificado_em=NULL`: continuam entrando, sem serem declaradas verificadas.
Contas novas recebem `email_verificacao_obrigatoria=true` e precisam confirmar
o endereco antes do primeiro login. Nao execute um UPDATE geral marcando contas
antigas como verificadas ou liberando contas novas. Em instalacoes novas,
`schema.sql` ja usa o padrao TRUE.

`POST /api/auth/register` cria usuario, perfil e hash do token de confirmacao na
mesma transacao e retorna 201 com `{ "message": "...", "emailVerificationRequired": true }`.
Nao retorna token JWT, usuario, perfil ou sessao. Com envio desabilitado, retorna
503 com `code: "EMAIL_DISABLED"` antes de criar uma conta que ficaria bloqueada.
O envio Gmail inicia depois do commit e da resposta; falhas preservam a conta
pendente, e o usuario pode solicitar outro link apos pelo menos 60 segundos.

`POST /api/auth/confirm-email` recebe `{ "token": "64-caracteres-hex" }` e retorna
200 com somente `message`. O token aleatorio tem SHA-256 armazenado em
`verificacao_token_hash`, separado do reset, validade de 24 horas e uso unico
consumido atomicamente. Link malformado, vencido, substituido ou usado retorna
400 com `code: "EMAIL_VERIFICATION_TOKEN_INVALID"`. Um GET nunca confirma a
conta: a pagina deve pedir que o usuario pressione o botao que faz o POST.
Confirmar nao inicia sessao automaticamente; depois o usuario faz login.

`POST /api/auth/resend-verification` recebe `{ "email": "..." }` e responde 200
generico para conta desconhecida, ja confirmada ou durante o
cooldown. A emissao e limitada atomicamente a uma vez por minuto por conta,
inclusive entre IPs/processos; um novo link invalida o anterior. Com envio
desabilitado, retorna o mesmo 503 `EMAIL_DISABLED` para qualquer endereco valido.
Indisponibilidade do banco retorna 503 `EMAIL_VERIFICATION_UNAVAILABLE`.
Contas antigas com e-mail ainda nao verificado tambem podem solicitar e concluir
essa confirmacao opcional: passam a `email_verificado=true` e mantem
`email_verificacao_obrigatoria=false`, sem perder o acesso anterior.

O login verifica a senha antes de informar que falta confirmar: senha errada
continua retornando 401; credenciais corretas de conta pendente retornam 403
com `code: "EMAIL_NOT_VERIFIED"`, sem JWT. O middleware repete essa verificacao
para recursos protegidos. Reset de senha nao confirma nem libera uma conta.
Os DTOs publicos do login e `/auth/me` incluem `email_verificado` e
`email_verificacao_obrigatoria`, sem hashes ou tokens internos.

O envio usa o mesmo mecanismo sem fila duravel documentado no reset: resposta
nao garante entrega, reinicios podem perder a tentativa e nao ha retry automatico.
Os logs guardam apenas codigos controlados. Exclusao da conta remove os campos
de verificacao juntamente com o usuario.

### 2.8 Aviso de senha alterada

Apos o sucesso de `POST /api/auth/reset-password` ou `PATCH /api/auth/password`,
o titular recebe um unico aviso de seguranca se o transporte estiver habilitado.
O destinatario vem do `UPDATE ... RETURNING id, email` que gravou a senha,
sem aceitar endereco enviado pelo cliente. O reset concorrente/reutilizado so
avisa a tentativa que efetivamente consumiu o token. Conta removida antes do
UPDATE da troca recebe 401, sem informar sucesso nem enviar aviso.

O e-mail inclui data e hora em `America/Sao_Paulo`, orientacao para quem nao
reconhece a alteracao, link `/esqueci-senha` na mesma origem de
`PASSWORD_RESET_URL` e suporte `poupeazy@gmail.com`. Nao inclui senha, hash,
token de acesso/recuperacao ou IP. Pedir um link no forgot-password, token
invalido/expirado/usado, senha invalida ou falha no banco nao dispara esse aviso.
Os corpos de sucesso das duas APIs permanecem os mesmos.

A senha e persistida antes do aviso, e o envio comeca depois da resposta HTTP.
`EMAIL_ENABLED=false` apenas omite o aviso; nao impede a troca ou o reset.
Falha no Gmail nao desfaz a senha nem transforma o sucesso em erro. Nao ha
retry automatico, fila duravel ou garantia de entrega: reinicio entre a
resposta e o envio pode perder o aviso. Os logs registram somente codigos
controlados. Esta etapa nao requer nova variavel de ambiente ou migration.

### 2.9 Preferencias e alertas financeiros opcionais

Antes de publicar os alertas, aplique `db/migrations/008_budget_email_alerts.sql`
no banco correto. A migration e idempotente e nao reenvia alertas nem ativa
preferencias existentes. `schema.sql` inclui as mesmas estruturas para uma
instalacao nova. Nao sao necessarios servico pago, nova dependencia ou nova
variavel de ambiente. O worker so inicia pelo `src/server.js` real e com
`EMAIL_ENABLED=true`; `createApp` e os testes nao iniciam agendamento.

`GET /api/preferencias-email` e `PATCH /api/preferencias-email` exigem sessao e
retornam este DTO; o PATCH aceita somente os campos editaveis enviados:

```json
{
  "alerta_orcamento_ativo": false,
  "alerta_orcamento_percentual": 80,
  "alerta_despesa_ativo": false,
  "alerta_despesa_valor_minimo": 100,
  "alerta_receita_ativo": false,
  "alerta_receita_valor_minimo": 100,
  "alerta_meta_concluida_ativo": false,
  "email_verificado": false
}
```

Todas as modalidades comecam desligadas. Percentual deve ser inteiro entre 1
e 100; os dois valores minimos sao numeros positivos entre 0,01 e 9999999999,99,
com ate duas casas decimais. `email_verificado` e somente leitura. Ativar
qualquer modalidade exige e-mail confirmado e pode retornar 403
`EMAIL_NOT_VERIFIED`; contas antigas continuam podendo entrar e confirmar
opcionalmente. A alteracao de uma modalidade preserva as demais.

**Orcamento:** a API acordada varre o mes atual em `America/Sao_Paulo` ao iniciar
e a cada 60 segundos. Soma somente despesas confirmadas, sem descontar receitas
nem usar `valor_real` liquido. Orcamentos zerados, meses passados/futuros e
usuarios sem opt-in/verificacao nao geram e-mail. O primeiro alerta ocorre ao
atingir o percentual escolhido (`>=`), e o segundo somente acima de 100% (`>`).
Se ambos forem ineditos na mesma avaliacao, um e-mail de excesso cobre os dois.
Em 100% exatos com limiar 100 ha apenas o primeiro. Cada tipo tem no maximo uma
tentativa por usuario/ano/mes; editar percentual, oscilar gastos, desligar/ligar
ou recriar o orcamento nao apaga a deduplicacao. Habilitar pode avaliar o saldo
ja existente do mes atual. Um cruzamento desfeito antes da varredura nao gera
alerta; a apuracao independe da origem dos dados (site/app, Pluggy ou WhatsApp).

**Novos lancamentos e metas:** triggers SQL registram eventos na mesma transacao
da escrita, sem SMTP/HTTP. Despesa/receita gera evento quando nasce confirmada
ou muda de pendente/cancelada para confirmada e seu valor atinge o minimo da respectiva
modalidade. Editar o valor/categoria de um registro ja confirmado nao cria novo
evento. Ativar uma modalidade nao busca eventos anteriores. Importacoes feitas
apos o opt-in podem gerar avisos, mesmo para lancamentos de data antiga.
Metas avisam ao concluir manualmente (inclusive ao criar concluida), atingir
o objetivo em estado ativo ou baixar o objetivo ate o valor ja acumulado;
canceladas nao avisam. Reabrir/oscilar nao repete a mesma meta.

O worker agrupa eventos novos por usuario/tipo em um e-mail por lote, com
quantidade, total e ate tres valores/datas; descricoes, nomes de itens e IDs
internos nao sao incluidos. A reserva dos eventos e o `lote_id` sao persistidos
antes do HTTP, e cada evento recebe seu estado final. Antes de enviar, a API
revalida dono, verificacao, modalidade, fonte, valor e status: fonte removida,
cancelada, abaixo do minimo ou modalidade desativada cancela o aviso pendente.
Deduplica-se por usuario/fonte/tipo, mesmo se a fonte for apagada. A fila nao
tem FK para usuario/fonte para evitar inverter locks dos triggers financeiros;
a exclusao da conta limpa a fila explicitamente depois das fontes e o worker
limpa orfaos, sem enviar a titulares inexistentes.

No Render Free, a API pode dormir: os avisos aguardam ate voltar a executar e
nao sao alertas bancarios instantaneos. Nao ha retry automatico. Reservas
abandonadas por reinicio viram `incerto` apos dois minutos e nao sao reenviadas;
isso privilegia evitar duplicatas e pode perder uma tentativa. E-mail aceito
pelo Gmail nao garante chegada a caixa de entrada. Desativar/excluir cancela
pendencias, mas nao revoga uma mensagem ja em transito. Logs guardam somente
codigos controlados, sem enderecos, valores, tokens ou respostas brutas.

No site, as preferencias ficam em Perfil; no mobile, Mais > Preferencias de
e-mail. Avisos de seguranca de senha nao dependem desses consentimentos.
Os testes budget-email-database.test.js e financial-event-email-database.test.js
usam PostgreSQL loopback descartavel e remetente falso para validar SQL,
deduplicacao, lotes, rollback, concorrencia e exclusao sem acessar Gmail/Neon.

### 2.10 Relatorios modulares por e-mail

Antes de publicar esta etapa, aplique `db/migrations/009_report_email.sql` no
banco correto, depois publique a API e os clientes. A migration idempotente
acrescenta somente `usuarios.relatorio_email_solicitado_em`; nenhuma migration
roda automaticamente no startup. Nao ha nova variavel de ambiente ou servico.

`POST /api/relatorios/email` exige JWT e e-mail confirmado. O destinatario e
sempre o e-mail atual da propria conta, consultado no banco. O corpo aceita
somente os quatro campos abaixo, sem destinatario ou anexos fornecidos pelo
cliente:

```json
{
  "data_inicio": "2026-11-01",
  "data_fim": "2026-11-27",
  "secoes": ["resumo", "categorias"],
  "formatos": ["pdf"]
}
```

As secoes disponiveis sao `resumo`, `transacoes`, `categorias`, `orcamentos` e
`metas`; os formatos sao `pdf` e `csv`. Cada lista precisa ter pelo menos uma
opcao, sem repeticoes. Somente as secoes escolhidas entram nos arquivos. O PDF
reune essas secoes; CSV gera um arquivo separado por secao, em UTF-8 com BOM,
separador ponto e virgula e protecao contra formulas em textos do usuario.

Datas devem ser reais no formato `YYYY-MM-DD`, entre 2000 e 2100, com intervalo
inclusivo de ate 366 dias. O periodo pode conter no maximo 1000 transacoes
confirmadas da conta, mesmo quando a secao de transacoes nao foi selecionada.
Se metas for selecionada, o limite e 200 metas atuais. Limites excedidos sao
rejeitados; os dados nao sao truncados. Sao permitidos ate seis anexos, com
limite total de 5 MiB. Para reduzir um pedido, diminua o periodo ou desmarque
secoes/formatos.

Resumo, transacoes e categorias consideram somente lancamentos confirmados no
intervalo. Resultado do periodo significa receitas menos despesas desse recorte,
sem representar saldo bancario. Orcamentos mostram o planejado integral do mes,
sem rateio, e despesas brutas confirmadas no recorte, com datas cobertas e
indicacao de mes parcial. Metas mostram status, objetivo e saldo atuais na
exportacao, acompanhados de aportes/retiradas confirmados no periodo; nao
reconstituem uma posicao historica. A leitura usa snapshot PostgreSQL
`REPEATABLE READ READ ONLY`, com timeout de cinco segundos por consulta.

O pedido e sincrono e limitado a um relatorio em processamento por instancia da
API. Antes da geracao, uma reserva atomica impõe intervalo de 60 segundos por
conta, preservado mesmo se a geracao ou o envio falhar. A API limita a espera a
45 segundos; clientes podem aguardar ate 120 segundos para incluir o despertar
da hospedagem. Nao ha fila, agendamento ou retry automatico. PDF e CSV sao
gerados em memoria, sem salvar arquivos, links publicos ou historico de
relatorios no servidor. O transporte aceita somente Buffers PDF/CSV com nomes
fixos e nao abre caminhos ou URLs fornecidos pelo cliente.

Uma resposta `200` contem `message` e `retry_after_seconds: 60` e indica que o
Gmail aceitou a mensagem, sem garantir chegada a caixa de entrada. Erros `429`
usam `REPORT_BUSY` ou `REPORT_COOLDOWN`, com `retry_after_seconds` e cabecalho
`Retry-After`. Erros `422` usam `REPORT_REQUEST_INVALID` ou
`REPORT_LIMIT_EXCEEDED`; `403 EMAIL_NOT_VERIFIED` pede confirmacao. Servico
desativado retorna `503 EMAIL_DISABLED`; falhas de geracao ou envio conhecido
retornam `503 REPORT_UNAVAILABLE`. `502 EMAIL_SEND_UNKNOWN` significa resultado
incerto depois de iniciar o envio: confira caixa de entrada e spam antes de
pedir novamente. Nenhum anexo, endereco ou erro bruto e registrado em logs.

O PDF usa as fontes Inter incluidas em `assets/fonts`, sob a licenca OFL
acompanhante. Caracteres sem glifo, como alguns emojis e ideogramas, aparecem
como `?` com nota no PDF; os CSVs preservam o texto Unicode original.
Os testes de relatorios usam dados sinteticos, transporte falso e PostgreSQL
descartavel opcional; nao enviam e-mails reais.

---


## 3. Testar no Postman

1. Importe o arquivo `PoupEazy.postman_collection.json`.
2. A collection ja vem com as variaveis `baseUrl` (`http://localhost:3001/api`) e `token`.
3. Para conta nova, rode **Auth > Register**, confirme pelo link recebido e depois
   rode **Login**. O cadastro nao retorna JWT. Guarde o token do login em
   `{{token}}`, utilizado pelas demais requisicoes.
4. A partir dai, teste as demais pastas (Metas, Orcamentos, Categorias, Despesas, etc.).

### Mapa de endpoints

Base: `http://localhost:3001/api` — exceto auth publico, tudo exige
`Authorization: Bearer <token>`.

| Metodo | Rota | Descricao |
|--------|------|-----------|
| GET  | `/health` | Status da API (publico) |
| POST | `/auth/register` | Cria conta pendente e retorna `{ message, emailVerificationRequired: true }`, sem sessao |
| POST | `/auth/confirm-email` | Confirma token de 24h por POST; retorna `{ message }` |
| POST | `/auth/resend-verification` | Solicita novo link com resposta generica e cooldown de 60s |
| POST | `/auth/login` | Login, retorna `{ token, user, profile }` |
| POST | `/auth/delete-account` | Publico: reautentica `{ email, password, confirmacao: "EXCLUIR" }` e exclui a conta e dados locais associados |
| GET  | `/auth/me` | Usuario + profile da sessao atual |
| POST | `/auth/forgot-password` | Solicita link por e-mail; resposta generica sem token e cooldown de 60s |
| POST | `/auth/reset-password` | Redefine senha com `{ token, novaSenha }` |
| PATCH| `/auth/password` | Troca a senha do usuario logado |
| GET  | `/profile` | Dados do profile |
| PATCH| `/profile` | Atualiza `nome` / `telefone` |
| GET / PATCH | `/preferencias-email` | Consulta / atualiza consentimentos e limites dos alertas financeiros |
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
| POST | `/relatorios/email` | Relatorio modular PDF/CSV para o e-mail confirmado da propria conta |

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
