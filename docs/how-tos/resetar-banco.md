# Como resetar o banco de dados

## Resetar o banco local (Docker)

Para apagar **todos os dados** e recriar o banco do zero:

```bash
docker compose down -v
docker compose up -d
```

O flag `-v` remove o volume `poupeazy_pgdata`, que armazena os dados do PostgreSQL. Na proxima subida, o Docker reaplica automaticamente o `db/schema.sql`.

## Resetar mantendo o container

Se quiser apagar os dados sem derrubar o container, use o script `db/reset.sql` seguido do `db/schema.sql`.

Via Adminer (`http://localhost:8080`):

1. Acesse o Adminer e conecte no banco.
2. Va em **Comando SQL**.
3. Cole e execute o conteudo de `db/reset.sql`.
4. Em seguida, cole e execute `db/schema.sql`.

Via linha de comando:

```bash
docker exec -i poupeazy_db psql -U poupeazy -d poupeazy < db/reset.sql
docker exec -i poupeazy_db psql -U poupeazy -d poupeazy < db/schema.sql
```

## Reaplicar apenas o schema (sem apagar dados)

Se voce alterou o schema e quer aplicar as mudancas sem perder dados existentes:

```bash
docker exec -i poupeazy_db psql -U poupeazy -d poupeazy < db/schema.sql
```

O schema usa `CREATE TABLE IF NOT EXISTS` e `CREATE OR REPLACE`, entao e seguro executar mais de uma vez. Porem, alteracoes em colunas existentes (renomear, trocar tipo) exigem comandos `ALTER TABLE` manuais.

## Resetar o banco em producao (Neon)

No SQL Editor do painel do Neon:

1. Execute o conteudo de `db/reset.sql`.
2. Execute o conteudo de `db/schema.sql`.

> **Cuidado:** isso apaga **todos** os dados de producao. Use apenas se realmente necessario.
