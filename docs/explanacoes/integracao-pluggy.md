# Integracao Open Finance com Pluggy

## O que e Open Finance

Open Finance e o sistema que permite que instituicoes financeiras compartilhem dados de clientes (com consentimento) de forma padronizada. No Brasil, e regulado pelo Banco Central.

Na pratica, isso significa que o PoupEazy pode acessar o extrato bancario do usuario automaticamente, em vez de depender que ele cadastre cada transacao manualmente.

## Por que a Pluggy

A Pluggy e uma fintech brasileira que funciona como intermediaria (agregadora) no ecossistema Open Finance. Ela abstrai a complexidade de se conectar diretamente a cada banco e oferece uma API unificada.

O PoupEazy usa a Pluggy para:

1. **Conectar contas bancarias** — o usuario autoriza o acesso via um Widget da Pluggy.
2. **Buscar extratos** — a API da Pluggy retorna as transacoes da conta conectada.

## Arquitetura da integracao

```
Frontend (React)
    |
    | 1. GET /api/pluggy/token
    |    (pede um connect token)
    v
API PoupEazy (Express)
    |
    | 2. pluggyClient.createConnectToken()
    |    (usa PLUGGY_CLIENT_ID + SECRET)
    v
Pluggy API
    |
    | 3. Retorna connectToken
    v
API PoupEazy -> Frontend
    |
    | 4. Abre o Widget da Pluggy com o connectToken
    v
Widget Pluggy (no navegador do usuario)
    |
    | 5. Usuario seleciona o banco e autoriza
    |    Widget retorna um itemId
    v
Frontend
    |
    | 6. POST /api/integracoes { instituicao, itemId }
    |    (salva a conexao no banco)
    v
API PoupEazy -> PostgreSQL (tabela open_finance_tokens)
```

Depois da conexao salva, o frontend pode buscar o extrato:

```
Frontend
    |
    | GET /api/pluggy/transactions/:itemId
    v
API PoupEazy
    |
    | pluggyClient.fetchAccounts(itemId)
    | pluggyClient.fetchTransactions(accountId)
    v
Pluggy API -> API PoupEazy -> Frontend
    |
    | Transacoes normalizadas:
    | { descricao, valor, tipo, data }
```

## Normalizacao dos dados

A Pluggy retorna transacoes no formato dela. A API do PoupEazy normaliza para o formato interno:

| Campo Pluggy | Campo PoupEazy | Transformacao |
|--------------|----------------|---------------|
| `description` | `descricao` | Direto |
| `amount` | `valor` | `Math.abs()` (sempre positivo) |
| `amount` (sinal) | `tipo` | Negativo = `'despesa'`, positivo = `'receita'` |
| `date` | `data` | Convertido para `YYYY-MM-DD` |

## Armazenamento de conexoes

As conexoes sao salvas na tabela `open_finance_tokens`:

- `access_token_enc` armazena o `itemId` da Pluggy (nao e um token de acesso propriamente, e o identificador do item conectado).
- `expira_em` e definido como 30 dias a partir da conexao.
- O upsert `ON CONFLICT (id_usuario, instituicao)` garante que reconectar o mesmo banco atualiza a conexao existente em vez de criar duplicatas.
- A desconexao e um soft delete (`ativo = false`), preservando o historico.

## Credenciais

As credenciais da Pluggy (`PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET`) ficam **exclusivamente no backend**, como variaveis de ambiente. O frontend nunca tem acesso direto a elas — so recebe o `connectToken` temporario gerado pela API.

O `PluggyClient` e instanciado uma unica vez (lazy initialization em `src/routes/pluggy.routes.js`) e reutilizado em todas as requisicoes.

## Limitacoes atuais

- As transacoes buscadas da Pluggy sao retornadas ao frontend mas **nao sao salvas automaticamente** como despesas no banco do PoupEazy. O usuario precisa confirmar/importar manualmente.
- Nao ha renovacao automatica de conexoes expiradas.
- O campo `refresh_token_enc` na tabela existe mas nao e utilizado atualmente.
