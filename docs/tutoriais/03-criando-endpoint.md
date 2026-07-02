# Tutorial: Criando seu primeiro endpoint

Neste tutorial voce vai criar um novo endpoint na API do PoupEazy do zero. Vamos adicionar uma rota `GET /api/dashboard/saldo` que retorna o saldo do usuario (receitas - despesas) como exercicio pratico.

## Entendendo a estrutura

Cada grupo de rotas do PoupEazy segue o mesmo padrao:

```
src/routes/<nome>.routes.js   # define as rotas com Express Router
src/server.js                 # registra o router em um prefixo (ex: /api/dashboard)
```

## Passo 1: Criar o arquivo de rotas

Crie o arquivo `src/routes/dashboard.routes.js`:

```javascript
const express = require('express');
const db = require('../db');
const { auth } = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/saldo
router.get('/saldo', auth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END), 0) AS receitas,
         COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END), 0) AS despesas
       FROM despesas d
       JOIN orcamento o ON o.id = d.id_orcamento
       WHERE o.id_usuario = $1 AND d.status = 'confirmada'`,
      [req.userId]
    );

    const { receitas, despesas } = rows[0];
    return res.json({
      receitas: Number(receitas),
      despesas: Number(despesas),
      saldo: Number(receitas) - Number(despesas),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
```

Observe o padrao:

1. **`auth`** como segundo argumento de `router.get()` — protege a rota, exigindo token JWT.
2. **`req.userId`** — injetado pelo middleware, filtra dados por usuario.
3. **`next(err)`** — delega erros para o tratador centralizado (`errorHandler`).
4. **Queries parametrizadas** (`$1`) — previne SQL injection.

## Passo 2: Registrar no server.js

Abra `src/server.js` e adicione duas linhas:

```javascript
// Junto com os outros requires, no topo:
const dashboardRoutes = require('./routes/dashboard.routes');

// Junto com os outros app.use(), antes do notFound:
app.use('/api/dashboard', dashboardRoutes);
```

## Passo 3: Testar

Se o servidor esta rodando com `npm run dev`, o nodemon reinicia automaticamente. Teste:

```bash
curl http://localhost:3001/api/dashboard/saldo \
  -H "Authorization: Bearer <seu-token>"
```

Resposta esperada:

```json
{
  "receitas": 0,
  "despesas": 0,
  "saldo": 0
}
```

(Zero porque o usuario novo ainda nao tem transacoes.)

## Passo 4: Adicionar validacao (exemplo com POST)

Se voce quiser criar uma rota que recebe dados, use `ApiError` para validar:

```javascript
const { ApiError } = require('../middleware/errorHandler');

router.post('/exemplo', auth, async (req, res, next) => {
  const { campo } = req.body || {};

  if (!campo) {
    return next(new ApiError(400, 'campo e obrigatorio.'));
  }

  // ... logica ...
});
```

## Resumo do padrao

Toda rota no PoupEazy segue esta receita:

| Etapa | O que fazer |
|-------|-------------|
| 1 | Criar `src/routes/<nome>.routes.js` com `express.Router()` |
| 2 | Usar `auth` middleware nas rotas protegidas |
| 3 | Filtrar dados com `req.userId` |
| 4 | Validar input com `ApiError(status, mensagem)` |
| 5 | Delegar erros com `next(err)` |
| 6 | Registrar em `server.js` com `app.use('/api/<prefixo>', routes)` |

> **Nota:** Este tutorial e um exercicio didatico. Nao e necessario commitar
> o endpoint de dashboard — o objetivo e entender o padrao das rotas.
