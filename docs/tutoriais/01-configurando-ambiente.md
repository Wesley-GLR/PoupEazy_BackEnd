# Tutorial: Configurando o ambiente de desenvolvimento

Neste tutorial voce vai preparar tudo o que precisa para rodar o PoupEazy Backend na sua maquina. Ao final, a API estara respondendo em `http://localhost:3001`.

## Pre-requisitos

Antes de comecar, instale:

- **Node.js 20+** - [nodejs.org](https://nodejs.org/)
- **Docker Desktop** - [docker.com](https://www.docker.com/products/docker-desktop/)
- **Um editor de codigo** (VS Code recomendado)
- **Postman** (opcional, para testar a API) - [postman.com](https://www.postman.com/)

Verifique se esta tudo instalado:

```bash
node --version   # deve exibir v20.x ou superior
docker --version # deve exibir Docker version 2x.x
npm --version    # deve exibir 10.x ou superior
```

## Passo 1: Clonar o repositorio

```bash
git clone <URL_DO_REPOSITORIO>
cd PoupEazy_BackEnd
```

## Passo 2: Configurar variaveis de ambiente

Copie o arquivo de exemplo e edite se necessario:

```bash
cp .env.example .env
```

Os valores padrao ja funcionam com o Docker local. O arquivo `.env` contem:

```
PORT=3001
DATABASE_URL=postgres://poupeazy:poupeazy@localhost:5432/poupeazy
JWT_SECRET=troque_este_segredo_por_um_valor_aleatorio_longo
JWT_EXPIRES_IN=7d
NODE_ENV=development
CORS_ORIGIN=*
```

> Para desenvolvimento local, os unicos valores que voce **pode** querer alterar sao
> `JWT_SECRET` (recomendado trocar por seguranca) e as credenciais Pluggy (se for
> testar Open Finance).

## Passo 3: Subir o banco de dados com Docker

```bash
docker compose up -d
```

Esse comando sobe dois servicos:

| Servico | Porta | Descricao |
|---------|-------|-----------|
| `poupeazy_db` | 5432 | PostgreSQL 16 com o schema aplicado automaticamente |
| `poupeazy_adminer` | 8080 | Interface web para inspecionar o banco |

Na primeira execucao, o Docker aplica automaticamente o `db/schema.sql`, criando todas as tabelas, triggers, views e categorias do sistema.

Verifique se o banco subiu:

```bash
docker compose ps
```

Os dois servicos devem estar com status `running (healthy)`.

## Passo 4: Instalar dependencias do Node.js

```bash
npm install
```

## Passo 5: Iniciar a API

```bash
npm run dev
```

Voce deve ver no terminal:

```
PoupEazy backend rodando na porta 3001 (development)
```

## Passo 6: Verificar que tudo funciona

Abra o navegador ou use `curl`:

```bash
curl http://localhost:3001/api/health
```

Resposta esperada:

```json
{
  "status": "ok",
  "env": "development",
  "time": "2026-07-02T12:00:00.000Z"
}
```

## Passo 7 (opcional): Inspecionar o banco pelo Adminer

Acesse `http://localhost:8080` no navegador e conecte com:

| Campo | Valor |
|-------|-------|
| Sistema | PostgreSQL |
| Servidor | db |
| Usuario | poupeazy |
| Senha | poupeazy |
| Base de dados | poupeazy |

## Alternativa: rodar tudo no Docker

Se preferir rodar a API tambem em container (sem instalar Node.js localmente):

```bash
docker compose --profile api up --build
```

Isso sobe o banco **e** a API juntos. A API ficara disponivel em `http://localhost:3001`.

## Proximo passo

Agora que o ambiente esta rodando, siga para [Entendendo o fluxo de autenticacao](02-fluxo-autenticacao.md) para aprender como funciona o login e registro de usuarios.
