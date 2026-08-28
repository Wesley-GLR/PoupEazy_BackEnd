const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/poupeazy_test';
process.env.JWT_SECRET ||= 'test-secret-with-at-least-thirty-two-bytes';

const {
  buildExpensesListQuery,
  normalizeTransactionBody,
} = require('../src/services/despesas.service');
const {
  buildConnectTokenOptions,
  chooseCategory,
  normalizePluggyTransaction,
  publicIntegration,
} = require('../src/services/pluggy.service');

const userId = 'b6fdfd35-3c12-4ff9-a61e-470f821b634b';

test('normaliza uma transacao manual completa', () => {
  const result = normalizeTransactionBody({
    id_orcamento: 'ca0bd9da-f216-4d86-b368-2f12e5ebad60',
    id_categoria: 'ebd2e951-5e93-40c7-a354-249291215dd1',
    valor: '15.50',
    data_transacao: '2026-08-26',
    descricao: '  Mercado  ',
    tipo: 'despesa',
  });
  assert.equal(result.valor, 15.5);
  assert.equal(result.descricao, 'Mercado');
  assert.equal(result.origem, 'manual');
  assert.equal(result.status, 'confirmada');
  assert.equal(result.id_metas, null);
});

test('PATCH vazio e categoria/tipo invalidos sao rejeitados', () => {
  assert.throws(() => normalizeTransactionBody({}, { partial: true }), /ao menos um campo/);
  assert.throws(() => normalizeTransactionBody({ tipo: 'credito' }, { partial: true }), /deve ser um de/);
});

test('query de despesas aplica dono, filtros e paginacao parametrizados', () => {
  const query = buildExpensesListQuery(userId, {
    q: 'mercado', tipo: 'despesa', data_inicio: '2026-08-01', data_fim: '2026-08-31', page: '2', limit: '25',
  });
  assert.equal(query.paginated, true);
  assert.equal(query.page, 2);
  assert.equal(query.limit, 25);
  assert.match(query.selectSql, /o\.id_usuario = \$1/);
  assert.match(query.selectSql, /LIMIT \$6 OFFSET \$7/);
  assert.deepEqual(query.selectValues.slice(-2), [25, 25]);
});

test('DTO publico de integracao nunca devolve tokens nem itemId', () => {
  const result = publicIntegration({
    id: '1', instituicao: 'Banco', access_token_enc: 'segredo', refresh_token_enc: 'segredo-2',
    expira_em: '2026-09-01', ultimo_uso: null, ativo: true, criado_em: '2026-08-01',
  });
  assert.deepEqual(Object.keys(result).sort(), ['ativo', 'criado_em', 'expira_em', 'id', 'instituicao', 'ultimo_uso']);
  assert.equal('access_token_enc' in result, false);
});

test('Connect Token fica associado ao usuario e evita duplicatas', () => {
  const options = buildConnectTokenOptions(userId);
  assert.equal(options.clientUserId, userId);
  assert.equal(options.avoidDuplicates, true);
});

test('normaliza debito Pluggy e escolhe categoria compativel', () => {
  const transaction = normalizePluggyTransaction({
    id: 'tx-1', amount: -42.5, description: 'Supermercado Central', date: '2026-08-20T12:00:00Z', status: 'POSTED',
  }, { id: 'acc-1', name: 'Conta corrente' });
  const category = chooseCategory([
    { id: 'receita', nome: 'Salário', tipo: 'receita' },
    { id: 'alimento', nome: 'Alimentação', tipo: 'despesa_variavel' },
  ], transaction);
  assert.equal(transaction.tipo, 'despesa');
  assert.equal(transaction.valor, 42.5);
  assert.equal(category.id, 'alimento');
});
