# Como fazer deploy no Render

## Pre-requisitos

- Conta no [Render](https://render.com/)
- Banco PostgreSQL ja provisionado (o PoupEazy usa [Neon](https://neon.tech/) em producao)
- Repositorio no GitHub com o codigo do backend

## Opcao 1: Blueprint (automatico)

O projeto inclui um arquivo `render.yaml` que configura tudo automaticamente.

1. No Render, va em **New > Blueprint**.
2. Conecte o repositorio GitHub do PoupEazy Backend.
3. O Render detecta o `render.yaml` e cria o Web Service.
4. Preencha as variaveis marcadas como `sync: false` no painel:

| Variavel | Valor |
|----------|-------|
| `DATABASE_URL` | Connection string do Neon (com `?sslmode=require`) |
| `CORS_ORIGIN` | URL do frontend (ex: `https://poup-eazy.vercel.app`) |
| `PLUGGY_CLIENT_ID` | Credencial da Pluggy (opcional) |
| `PLUGGY_CLIENT_SECRET` | Credencial da Pluggy (opcional) |

5. `JWT_SECRET` e gerado automaticamente pelo Render (`generateValue: true`).

## Opcao 2: Manual

1. No Render, va em **New > Web Service**.
2. Conecte o repositorio.
3. Configure:
   - **Runtime**: Docker
   - **Dockerfile Path**: `./Dockerfile`
   - **Plan**: Free (ou o desejado)
   - **Region**: Oregon (mesma regiao do Neon para menor latencia)
   - **Health Check Path**: `/api/health`
4. Adicione as variaveis de ambiente:
   - `NODE_ENV=production`
   - `JWT_SECRET=<valor-longo-e-aleatorio>`
   - `JWT_EXPIRES_IN=7d`
   - `DATABASE_URL=<connection-string-do-neon>`
   - `CORS_ORIGIN=<url-do-frontend>`
5. Clique em **Create Web Service**.

## Verificar o deploy

```bash
curl https://poupeazy-backend.onrender.com/api/health
```

Resposta esperada:

```json
{ "status": "ok", "env": "production", "time": "..." }
```

## Observacoes

- O plano free do Render hiberna apos ~15 minutos sem requisicoes. A primeira requisicao depois disso fica mais lenta (cold start).
- O `autoDeploy: true` no `render.yaml` faz deploy automatico a cada push na branch principal.
- O schema SQL deve ser aplicado manualmente no Neon (copie `db/schema.sql` e execute no SQL Editor do Neon).
