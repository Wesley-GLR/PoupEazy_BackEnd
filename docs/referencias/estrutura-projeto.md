# Referencia: Estrutura do projeto

```
PoupEazy_BackEnd/
├── docs/                        # Documentacao (Diataxis)
│   ├── index.md                 # Indice geral da documentacao
│   ├── tutoriais/               # Guias passo a passo para aprender
│   ├── how-tos/                 # Receitas praticas para tarefas especificas
│   ├── referencias/             # Informacao tecnica detalhada
│   └── explanacoes/             # Textos conceituais e decisoes de arquitetura
│
├── db/
│   ├── schema.sql               # DDL completo: tabelas, triggers, views, seed
│   └── reset.sql                # Script para apagar todas as tabelas (dev)
│
├── scripts/
│   └── init-db.js               # Aplica o schema via Node.js (npm run db:init)
│
├── src/
│   ├── server.js                # Entrypoint: Express app, montagem de rotas, CORS
│   ├── config.js                # Leitura e validacao de variaveis de ambiente
│   ├── db.js                    # Pool de conexao PostgreSQL (pg)
│   │
│   ├── middleware/
│   │   ├── auth.js              # Middleware JWT (auth) + gerarToken()
│   │   └── errorHandler.js      # ApiError, notFound, errorHandler centralizado
│   │
│   └── routes/
│       ├── auth.routes.js       # Register, login, me, forgot/reset password
│       ├── profile.routes.js    # GET/PATCH profile do usuario
│       ├── metas.routes.js      # CRUD de metas financeiras
│       ├── orcamentos.routes.js # CRUD de orcamentos mensais + get-or-create
│       ├── categorias.routes.js # CRUD de categorias (sistema + personalizadas)
│       ├── despesas.routes.js   # CRUD de transacoes (despesas/receitas)
│       ├── notificacoes.routes.js # Listar, marcar lida, deletar notificacoes
│       ├── integracoes.routes.js  # Conexoes Open Finance (conectar/desconectar banco)
│       ├── pluggy.routes.js     # Gerar connect token + buscar extrato Pluggy
│       └── relatorios.routes.js # Consulta as views de relatorios
│
├── docker-compose.yml           # PostgreSQL + Adminer + API (opcional via --profile api)
├── Dockerfile                   # Imagem Docker da API (Node 20 Alpine)
├── render.yaml                  # Blueprint para deploy automatico no Render
├── .env.example                 # Template de variaveis de ambiente
├── .dockerignore                # Arquivos ignorados no build Docker
├── .gitignore                   # Arquivos ignorados pelo Git
├── package.json                 # Dependencias e scripts npm
└── PoupEazy.postman_collection.json  # Collection Postman para testes
```

## Dependencias principais

| Pacote | Versao | Uso |
|--------|--------|-----|
| `express` | ^4.21 | Framework HTTP |
| `pg` | ^8.13 | Driver PostgreSQL |
| `jsonwebtoken` | ^9.0 | Geracao e verificacao de tokens JWT |
| `bcryptjs` | ^2.4 | Hash de senhas |
| `cors` | ^2.8 | Middleware CORS |
| `dotenv` | ^16.4 | Carregamento de `.env` |
| `pluggy-sdk` | ^0.85 | SDK da Pluggy para Open Finance |
| `nodemon` | ^3.1 | Hot reload em desenvolvimento (devDependency) |

## Scripts npm

| Comando | Descricao |
|---------|-----------|
| `npm start` | Inicia a API em modo producao (`node src/server.js`) |
| `npm run dev` | Inicia com hot reload (`nodemon src/server.js`) |
| `npm run db:init` | Aplica o schema SQL via Node.js |
| `npm run up` | `docker compose up -d --build` |
| `npm run down` | `docker compose down` |
| `npm run reset` | `docker compose down -v` (apaga dados) |
| `npm run logs` | `docker compose logs -f api` |
