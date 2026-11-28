# Tutorial: Entendendo o fluxo de autenticacao

Neste tutorial voce vai aprender como o PoupEazy autentica usuarios, desde o cadastro ate a protecao das rotas. Usaremos `curl` para interagir com a API e entender cada etapa.

## Conceitos-chave

O PoupEazy usa **JWT (JSON Web Token)** para autenticacao:

1. O usuario se cadastra ou faz login, enviando email e senha.
2. A API valida as credenciais e retorna um **token JWT**.
3. O frontend envia esse token em todas as requisicoes seguintes no header `Authorization: Bearer <token>`.
4. O middleware `auth` decodifica o token e injeta `req.userId` na requisicao.
5. Cada rota filtra os dados por `id_usuario`, garantindo que o usuario so ve seus proprios dados.

## Passo 1: Registrar um usuario

```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "minhaSenha123",
    "nome": "Usuario Teste"
  }'
```

Resposta (status `201`):

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid-do-usuario",
    "email": "teste@exemplo.com",
    "criado_em": "2026-07-02T12:00:00.000Z"
  },
  "profile": {
    "id": "uuid-do-usuario",
    "nome": "Usuario Teste",
    "telefone": null,
    "criado_em": "2026-07-02T12:00:00.000Z",
    "atualizado_em": "2026-07-02T12:00:00.000Z"
  }
}
```

**O que aconteceu por tras:**

1. A API verificou se o email ja existe na tabela `usuarios`.
2. A senha foi hasheada com `bcrypt` (custo 10) e armazenada como `senha_hash`.
3. Uma transacao SQL criou o registro em `usuarios` **e** em `profiles` juntos.
4. Um token JWT foi gerado com `{ sub: usuario.id, email: usuario.email }` e expiracao de 7 dias.

## Passo 2: Fazer login

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "teste@exemplo.com",
    "password": "minhaSenha123"
  }'
```

A resposta e identica ao registro: `{ token, user, profile }`.

## Passo 3: Usar o token em rotas protegidas

Copie o valor do `token` retornado e use-o no header `Authorization`:

```bash
curl http://localhost:3001/api/metas \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

Isso retorna as metas do usuario autenticado (vazia no inicio: `[]`).

**Sem o token**, a resposta e:

```json
{ "error": "Token de autenticacao ausente." }
```

## Passo 4: Consultar o usuario da sessao

```bash
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

Retorna os dados do usuario e profile sem precisar informar o ID — o middleware extrai do token.

## Como o middleware funciona

O arquivo `src/middleware/auth.js` intercepta a requisicao antes de chegar na rota:

```
Requisicao HTTP
  -> Header "Authorization: Bearer <token>"
  -> Middleware auth()
     -> jwt.verify(token, JWT_SECRET)
     -> Extrai payload.sub (id do usuario)
     -> Seta req.userId e req.userEmail
  -> Rota (usa req.userId para filtrar dados)
```

Se o token estiver ausente, invalido ou expirado, o middleware retorna `401` e a rota nunca e executada.

## Estrutura do token JWT

O payload do token contem:

```json
{
  "sub": "uuid-do-usuario",
  "email": "teste@exemplo.com",
  "iat": 1719921600,
  "exp": 1720526400
}
```

| Campo | Descricao |
|-------|-----------|
| `sub` | ID do usuario (chave primaria na tabela `usuarios`) |
| `email` | Email do usuario |
| `iat` | Timestamp de emissao (issued at) |
| `exp` | Timestamp de expiracao (7 dias apos emissao, configuravel via `JWT_EXPIRES_IN`) |

## Proximo passo

Agora que voce entende o fluxo de autenticacao, siga para [Criando seu primeiro endpoint](03-criando-endpoint.md) para aprender a adicionar novas rotas a API.
