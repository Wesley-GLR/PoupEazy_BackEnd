# Como conectar uma conta bancaria (Open Finance)

## Pre-requisitos

- Credenciais da Pluggy configuradas no `.env`:
  ```
  PLUGGY_CLIENT_ID=seu_client_id_aqui
  PLUGGY_CLIENT_SECRET=seu_client_secret_aqui
  ```
- Conta de teste criada no [dashboard da Pluggy](https://dashboard.pluggy.ai)

## Passo 1: Gerar o connect token

O frontend precisa de um token temporario para abrir o Widget da Pluggy.

```bash
curl http://localhost:3001/api/pluggy/token \
  -H "Authorization: Bearer <seu-jwt>"
```

Resposta:

```json
{ "connectToken": "token-temporario-da-pluggy" }
```

## Passo 2: Conectar o banco (simulando o frontend)

Apos o usuario conectar uma instituicao pelo Widget da Pluggy, o frontend envia o `itemId` recebido:

```bash
curl -X POST http://localhost:3001/api/integracoes \
  -H "Authorization: Bearer <seu-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "instituicao": "Banco Exemplo",
    "itemId": "item-id-retornado-pela-pluggy"
  }'
```

A conexao e salva na tabela `open_finance_tokens` com validade de 30 dias.

## Passo 3: Consultar o extrato

```bash
curl http://localhost:3001/api/pluggy/transactions/<itemId> \
  -H "Authorization: Bearer <seu-jwt>"
```

Resposta:

```json
{
  "transactions": [
    {
      "descricao": "PIX Recebido",
      "valor": 1500.00,
      "tipo": "receita",
      "data": "2026-06-28"
    },
    {
      "descricao": "Supermercado ABC",
      "valor": 234.50,
      "tipo": "despesa",
      "data": "2026-06-27"
    }
  ]
}
```

As transacoes ja vem normalizadas: `valor` e sempre positivo, e o `tipo` indica se e receita ou despesa.

## Passo 4: Listar conexoes ativas

```bash
curl http://localhost:3001/api/integracoes \
  -H "Authorization: Bearer <seu-jwt>"
```

## Passo 5: Desconectar um banco

```bash
curl -X DELETE http://localhost:3001/api/integracoes/<id-da-conexao> \
  -H "Authorization: Bearer <seu-jwt>"
```

A conexao nao e apagada — apenas marcada como `ativo = false`.

## Usando a Pluggy em modo sandbox

No dashboard da Pluggy, voce pode usar conectores de teste (sandbox) que retornam dados ficticios. Isso permite testar o fluxo completo sem vincular uma conta bancaria real.
