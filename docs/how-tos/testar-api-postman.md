# Como testar a API com Postman

## Importar a collection

1. Abra o Postman.
2. Clique em **Import** e selecione o arquivo `PoupEazy.postman_collection.json` na raiz do projeto.
3. A collection ja vem configurada com as variaveis `baseUrl` (`http://localhost:3001/api`) e `token`.

## Autenticar

1. Abra a requisicao **Auth > Register** (ou **Login**).
2. Envie a requisicao.
3. O script de teste embutido na collection salva automaticamente o JWT na variavel `{{token}}`.
4. Todas as outras requisicoes ja usam `Authorization: Bearer {{token}}` — nao precisa copiar manualmente.

## Testar os endpoints

Com o token salvo, abra qualquer pasta da collection (Metas, Orcamentos, Categorias, Despesas, etc.) e envie as requisicoes normalmente.

Ordem sugerida para um teste completo:

1. **Auth > Register** — criar usuario
2. **Orcamentos > POST** — criar orcamento do mes (necessario para despesas)
3. **Categorias > GET** — listar categorias disponiveis
4. **Despesas > POST** — criar uma transacao
5. **Relatorios > Resumo Mensal** — ver o resumo gerado

## Trocar a URL base

Se quiser testar contra o ambiente de producao:

1. Clique na collection **PoupEazy** no painel lateral.
2. Va na aba **Variables**.
3. Altere `baseUrl` para `https://poupeazy-backend.onrender.com/api`.

## Dica: ver o token manualmente

Se precisar inspecionar o token, va em **Environment** (canto superior direito) e procure a variavel `token`. Voce pode copiar o valor e decodificar em [jwt.io](https://jwt.io/) para ver o payload.
