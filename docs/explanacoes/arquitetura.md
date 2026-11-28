# Visao geral da arquitetura

## Stack tecnologica

O PoupEazy Backend e uma API REST construida com:

- **Node.js 20** como runtime
- **Express 4** como framework HTTP
- **PostgreSQL 16** como banco de dados relacional
- **JWT** para autenticacao stateless
- **Docker** para ambiente de desenvolvimento e deploy
- **Pluggy SDK** para integracao Open Finance

## Decisao pela stack

A escolha de Node.js + Express + PostgreSQL foi guiada por tres fatores:

1. **Familiaridade da equipe** — o frontend ja era em JavaScript (React/Vite), entao manter a mesma linguagem no backend reduz a troca de contexto.
2. **Ecossistema maduro** — Express e o framework Node.js mais documentado e com maior base de pacotes. PostgreSQL oferece robustez relacional com recursos modernos (JSONB, window functions, triggers).
3. **Simplicidade para projeto academico** — a stack e direta: nao ha ORM, nao ha framework opinativo (como NestJS), nao ha camada de abstracao alem do necessario. Cada rota e uma funcao com SQL explicito.

## Arquitetura da aplicacao

```
Cliente (Frontend React)
    |
    | HTTPS (JSON)
    |
API Express (src/server.js)
    |
    +-- Middleware CORS
    +-- Middleware JSON parser
    +-- Middleware Auth (JWT) ---- para rotas protegidas
    +-- Rotas (src/routes/*.routes.js)
    |       |
    |       +-- Validacao de input
    |       +-- Queries SQL parametrizadas
    |       +-- Tratamento de erros (next(err))
    |       |
    |       v
    +-- Pool PostgreSQL (src/db.js)
    |       |
    |       v
    +-- PostgreSQL (tabelas, triggers, views)
    |
    +-- Middleware notFound (404)
    +-- Middleware errorHandler (500)
```

### Sem camadas intermediarias

O projeto **nao** usa:

- **ORM** (Sequelize, Prisma, TypeORM) — as queries sao SQL puro via `pg`. Isso da controle total e evita a "magica" de um ORM que pode esconder comportamentos. Para um projeto academico, entender o SQL real e mais valioso.
- **Controllers separados** — a logica de negocio esta diretamente nos arquivos de rota. Cada rota e curta o suficiente para nao justificar uma camada extra.
- **Services/Repositories** — pelo mesmo motivo acima. O projeto e de escopo controlado e a adicao de camadas aumentaria a complexidade sem beneficio proporcional.

Essa simplicidade e intencional: cada arquivo de rota e autocontido — voce le o request, a query SQL e o response em um unico lugar.

## Fluxo de uma requisicao

1. O cliente envia uma requisicao HTTP (ex: `GET /api/metas`).
2. O Express roteia para o arquivo de rotas correspondente.
3. O middleware `auth` intercepta, valida o JWT e injeta `req.userId`.
4. A rota executa uma query SQL parametrizada filtrando por `req.userId`.
5. O resultado e retornado como JSON.
6. Se ocorrer um erro, `next(err)` delega para o `errorHandler`, que retorna `{ error: "mensagem" }` com o status HTTP adequado.

## Banco de dados

O PostgreSQL faz mais do que armazenar dados — ele participa ativamente da logica de negocio:

- **Triggers** recalculam `valor_real` do orcamento e `valor_atual` das metas automaticamente quando transacoes sao inseridas, atualizadas ou deletadas.
- **Views** pre-calculam relatorios (resumo mensal, progresso de metas, historico comparativo).
- **Constraints** garantem integridade (CHECK, UNIQUE, FK com ON DELETE).

Essa abordagem move parte da logica para o banco, evitando inconsistencias que poderiam ocorrer se o calculo fosse feito apenas na aplicacao.

## Deploy

```
                    Internet
                       |
        +--------------+--------------+
        |                             |
  Vercel (Frontend)          Render (API Docker)
                                      |
                              Neon (PostgreSQL)
```

- **Frontend** em React/Vite hospedado na Vercel (deploy automatico via Git).
- **API** em container Docker hospedada no Render (deploy automatico via `render.yaml`).
- **Banco** PostgreSQL gerenciado pelo Neon (serverless, com SSL).

Os tres servicos se comunicam via HTTPS. O CORS da API e configurado para aceitar apenas a origem do frontend em producao.
