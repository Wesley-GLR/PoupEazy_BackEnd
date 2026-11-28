# Por que migramos do Supabase para backend proprio

## Contexto

O PoupEazy comecou usando o **Supabase** como backend completo: autenticacao (`auth.users`), banco de dados (PostgreSQL gerenciado) e Row Level Security (RLS) para controle de acesso. O frontend React chamava diretamente o Supabase Client.

## Motivacao da migracao

Tres fatores levaram a decisao de construir um backend proprio:

### 1. Controle total sobre a autenticacao

Com o Supabase Auth, o fluxo de login, registro, reset de senha e gerenciamento de sessao eram caixas-pretas. Qualquer customizacao (como mudar o formato do token, adicionar campos ao registro, ou controlar a expiracao) dependia das configuracoes e limitacoes do Supabase.

Com JWT proprio, a equipe tem visibilidade completa: sabe como o token e gerado (`jsonwebtoken`), como a senha e armazenada (`bcrypt`), e como o middleware valida cada requisicao.

### 2. Integracao Open Finance

A integracao com a Pluggy exige um backend intermediario para:

- Armazenar credenciais da API (client ID / secret) sem expor no frontend.
- Gerar connect tokens para o Widget.
- Buscar e normalizar extratos bancarios.

Embora o Supabase tenha Edge Functions, um servidor Express dedicado oferece mais flexibilidade e debugabilidade.

### 3. Aprendizado academico

Como projeto de ADS (Analise e Desenvolvimento de Sistemas), construir o backend do zero proporciona aprendizado real sobre:

- Autenticacao e seguranca (hash de senhas, JWT, middleware).
- SQL puro (queries parametrizadas, triggers, views).
- Infraestrutura (Docker, deploy, variaveis de ambiente).
- Arquitetura de API REST.

Usar o Supabase abstraia esses conceitos, que sao fundamentais para a formacao.

## O que mudou

| Aspecto | Antes (Supabase) | Depois (Backend proprio) |
|---------|:-----------------:|:------------------------:|
| Autenticacao | `supabase.auth.signUp/signIn` | `POST /api/auth/register` e `login` com bcrypt + JWT |
| Controle de acesso | RLS com `auth.uid()` | Middleware `auth` + filtro `WHERE id_usuario = $1` |
| Criacao de profile | Trigger `handle_new_user` | Transacao na rota de registro |
| Consulta ao banco | `supabase.from('tabela').select()` | `db.query('SELECT ...', [params])` |
| Hospedagem do banco | Supabase (embutido) | Neon (PostgreSQL serverless) |
| Hosting da API | Nao havia (frontend direto) | Render (Docker) |

## O que foi preservado

- **Schema do banco** — as mesmas tabelas, colunas, tipos e constraints. O arquivo `db/schema.sql` e uma adaptacao direta do schema que existia no Supabase.
- **Triggers e views** — reescritos em PL/pgSQL puro, sem dependencia de funcoes do Supabase (`auth.uid()`).
- **Categorias do sistema** — o seed de categorias padrao e identico.
- **Estrutura de dados do frontend** — o formato dos JSONs retornados pela API foi mantido compativel, minimizando mudancas no frontend.
