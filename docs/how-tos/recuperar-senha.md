# Como recuperar a senha de um usuario

## Fluxo completo

A recuperacao de senha funciona em duas etapas:

### Etapa 1: Solicitar o reset

```bash
curl -X POST http://localhost:3001/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{ "email": "usuario@exemplo.com" }'
```

Resposta:

```json
{
  "message": "Se o e-mail existir, um link de recuperacao foi gerado.",
  "resetToken": "a1b2c3d4e5f6..."
}
```

> O campo `resetToken` so aparece em modo **development** (`NODE_ENV=development`).
> Em producao, o token seria enviado por e-mail (funcionalidade de e-mail nao implementada).

### Etapa 2: Redefinir a senha

```bash
curl -X POST http://localhost:3001/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "a1b2c3d4e5f6...",
    "novaSenha": "minhaNovaSenha456"
  }'
```

Resposta:

```json
{ "message": "Senha atualizada com sucesso." }
```

## Detalhes tecnicos

- O token de reset e gerado com `crypto.randomBytes(32)` (256 bits).
- Validade: **1 hora** a partir da geracao.
- Apos o uso, o token e removido do banco (`reset_token = NULL`).
- A API retorna a mesma mensagem generica independente de o email existir ou nao (previne enumeracao de usuarios).
- A nova senha deve ter no minimo **6 caracteres**.

## No frontend

O frontend redireciona o usuario para `/redefinir-senha?token=SEU_TOKEN`. Essa pagina consome o endpoint `POST /api/auth/reset-password` com o token da URL e a nova senha digitada.

## Trocar a senha estando logado

Se o usuario esta autenticado e quer trocar a propria senha:

```bash
curl -X PATCH http://localhost:3001/api/auth/password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "novaSenha": "outraSenha789" }'
```
