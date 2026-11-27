const bcrypt = require('bcryptjs');
const { ApiError } = require('../middleware/errorHandler');

// Hash publico de um valor sem privilegios, usado apenas para manter a comparacao
// bcrypt tambem quando o endereco informado nao pertence a uma conta.
const UNKNOWN_ACCOUNT_HASH = '$2a$10$xKqntE5Bcq4adi1WfTsqpOK3iKDRscMlZQlyudKtV0Bk1AN1YIcNu';

async function deleteAccount({ database, email, password }) {
  const client = await database.getClient();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Serializa exclusao e alteracoes de credenciais da mesma conta.
    const { rows: [user] } = await client.query(
      'SELECT id, senha_hash FROM usuarios WHERE LOWER(email) = $1 FOR UPDATE',
      [email]
    );
    const matches = await bcrypt.compare(password, user?.senha_hash || UNKNOWN_ACCOUNT_HASH);
    if (!user || !matches) {
      throw new ApiError(401, 'E-mail ou senha invalidos.');
    }

    await client.query('SELECT id FROM profiles WHERE id = $1 FOR UPDATE', [user.id]);

    // Despesas precisam sair antes de orcamentos/categorias (FKs RESTRICT).
    // A propriedade vem do orcamento; nunca do ID recebido pelo cliente.
    await client.query(
      `DELETE FROM despesas USING orcamento
        WHERE despesas.id_orcamento = orcamento.id AND orcamento.id_usuario = $1`,
      [user.id]
    );
    await client.query('DELETE FROM notificacoes WHERE id_usuario = $1', [user.id]);
    // Bancos anteriores a migration 005 podem nao ter a integracao opcional.
    const { rows: [whatsappTables] } = await client.query(
      `SELECT to_regclass('whatsapp_vinculos') AS vinculos,
              to_regclass('whatsapp_codigos') AS codigos,
              to_regclass('whatsapp_mensagens') AS mensagens`
    );
    if (whatsappTables.mensagens) {
      if (!whatsappTables.vinculos) throw new Error('Schema WhatsApp inconsistente.');
      await client.query(
        `DELETE FROM whatsapp_mensagens USING whatsapp_vinculos
          WHERE whatsapp_mensagens.id_vinculo = whatsapp_vinculos.id
            AND whatsapp_vinculos.id_usuario = $1`,
        [user.id]
      );
    }
    if (whatsappTables.codigos) {
      await client.query('DELETE FROM whatsapp_codigos WHERE id_usuario = $1', [user.id]);
    }
    if (whatsappTables.vinculos) {
      await client.query('DELETE FROM whatsapp_vinculos WHERE id_usuario = $1', [user.id]);
    }

    // access_token_enc contem o itemId da Pluggy no contrato atual. Removemos
    // apenas o vinculo local: nenhum item remoto e excluido por um ID legado
    // que poderia pertencer a outra pessoa. Revogacao externa exige fluxo proprio.
    await client.query('DELETE FROM open_finance_tokens WHERE id_usuario = $1', [user.id]);
    await client.query('DELETE FROM metas WHERE id_usuario = $1', [user.id]);
    await client.query('DELETE FROM categoria WHERE id_usuario = $1', [user.id]);
    await client.query('DELETE FROM orcamento WHERE id_usuario = $1', [user.id]);
    // O perfil e removido pela FK CASCADE. Reset tokens saem com o usuario.
    await client.query('DELETE FROM usuarios WHERE id = $1', [user.id]);

    await client.query('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        // eslint-disable-next-line no-console
        console.error('[auth] Falha ao desfazer exclusao de conta:', rollbackError);
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { deleteAccount };
