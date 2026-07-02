# Referencia: Variaveis de ambiente

Todas as variaveis sao lidas em `src/config.js` no boot da aplicacao. As obrigatorias causam `process.exit(1)` se ausentes.

## Variaveis

| Variavel | Obrigatoria | Default | Descricao |
|----------|:-----------:|---------|-----------|
| `PORT` | Nao | `3001` | Porta em que a API escuta |
| `DATABASE_URL` | **Sim** | — | Connection string do PostgreSQL. Local: `postgres://poupeazy:poupeazy@localhost:5432/poupeazy`. Producao (Neon): inclui `?sslmode=require` |
| `JWT_SECRET` | **Sim** | — | Segredo para assinar tokens JWT. Deve ser longo e aleatorio |
| `JWT_EXPIRES_IN` | Nao | `7d` | Tempo de expiracao do token JWT (formato do `jsonwebtoken`: `7d`, `24h`, `3600`) |
| `NODE_ENV` | Nao | `development` | `development` ou `production`. Afeta: SSL do banco, exibicao do reset token, CORS |
| `CORS_ORIGIN` | Nao | `*` | Origens permitidas no CORS. Aceita uma URL ou varias separadas por virgula. Use `*` apenas em desenvolvimento |
| `PLUGGY_CLIENT_ID` | Nao | — | Client ID da Pluggy (necessario apenas para funcionalidades Open Finance) |
| `PLUGGY_CLIENT_SECRET` | Nao | — | Client Secret da Pluggy |

## Comportamento por ambiente

| Aspecto | `development` | `production` |
|---------|:-------------:|:------------:|
| SSL no PostgreSQL | Desabilitado | Habilitado (`rejectUnauthorized: false`) |
| Reset token no body | Retornado em `POST /auth/forgot-password` | Omitido |
| CORS | `*` por padrao | Deve ser configurado com a URL do frontend |

## Arquivo `.env.example`

```bash
PORT=3001
DATABASE_URL=postgres://poupeazy:poupeazy@localhost:5432/poupeazy
JWT_SECRET=troque_este_segredo_por_um_valor_aleatorio_longo
JWT_EXPIRES_IN=7d
NODE_ENV=development
CORS_ORIGIN=*
PLUGGY_CLIENT_ID=seu_client_id_aqui
PLUGGY_CLIENT_SECRET=seu_client_secret_aqui
```

## Variaveis no Render (producao)

| Variavel | Configuracao no Render |
|----------|----------------------|
| `JWT_SECRET` | `generateValue: true` (gerado automaticamente) |
| `NODE_ENV` | `production` |
| `JWT_EXPIRES_IN` | `7d` |
| `DATABASE_URL` | Preenchida manualmente (connection string do Neon) |
| `CORS_ORIGIN` | Preenchida manualmente (URL do frontend na Vercel) |
| `PLUGGY_CLIENT_ID` | Preenchida manualmente (opcional) |
| `PLUGGY_CLIENT_SECRET` | Preenchida manualmente (opcional) |
