# Demonstração do PoupEazy no WhatsApp

O bot usa o mesmo modelo de transações da API Express e PostgreSQL do PoupEazy. A demonstração pode rodar localmente ou com a API publicada no Render. O site e o beta Android usam o mesmo vínculo quando apontam para essa API.

## Alternativa gratuita com Vonage

O [Messages API Sandbox](https://developer.vonage.com/en/messages/concepts/messages-api-sandbox) permite testar com um número compartilhado, sem verificar a empresa na Meta. Para a demonstração, cada participante deve ativar seu número de WhatsApp na lista do Sandbox uma vez. Esse cadastro dá acesso ao número de teste, e o vínculo no PoupEazy identifica de qual conta são as mensagens.

1. Abra [Messages API Sandbox](https://dashboard.nexmo.com/messages/sandbox), escolha **WhatsApp → Add to sandbox** e envie a mensagem de adesão pelo celular que vai participar.
2. No `.env` local, ajuste `WHATSAPP_ENABLED=true` e `WHATSAPP_PROVIDER=vonage_sandbox`. Informe `VONAGE_WHATSAPP_NUMBER` com o número remetente exibido no Sandbox, só dígitos. Preencha `VONAGE_API_KEY`, `VONAGE_API_SECRET` e `VONAGE_SIGNATURE_SECRET` com os dados da mesma chave de API do painel. O segredo de assinatura fica em [API Settings → Signed Webhooks](https://developer.vonage.com/en/dashboard/control/api-settings#signed-webhooks).
3. Suba a API, o site e o webhook local conforme a seção [Subir o site, a API e o webhook](#subir-o-site-a-api-e-o-webhook). No painel da Vonage, configure **Inbound webhook** para `https://SEU-TUNEL/api/whatsapp/webhook` e **Status webhook** para `https://SEU-TUNEL/api/whatsapp/webhook/status`, usando a URL do túnel. Esses dois callbacks devem enviar JWT assinado pela Vonage. Para enviar gráficos em PNG, configure `VONAGE_MEDIA_BASE_URL` com a origem HTTPS desse túnel e reinicie o webhook. As imagens expiram em 10 minutos.
4. No site ou na versão local do app, entre em **Transações → Registrar via WhatsApp**, gere o link de vínculo e envie a mensagem preparada. Depois que o bot confirmar, use a mesma conversa para lançar gastos e pedir relatórios. O vínculo fica salvo mesmo quando o código inicial vence. Use **Desvincular** para trocar de número.

Para voltar ao fluxo da Meta, selecione `WHATSAPP_PROVIDER=meta` e reinicie a API e o webhook.

## Publicar a demonstração para o site e a beta

1. Publique o backend com `WHATSAPP_ENABLED=false`. No ambiente que acessa o banco publicado, execute `npm run db:migrate:whatsapp`. O comando aplica as migrações 005 e 006 ao banco existente e pode ser repetido.
2. Configure no servidor `WHATSAPP_PROVIDER=vonage_sandbox`, `VONAGE_WHATSAPP_NUMBER`, `VONAGE_API_KEY`, `VONAGE_API_SECRET` e `VONAGE_SIGNATURE_SECRET`. Para o gráfico, defina `VONAGE_MEDIA_BASE_URL` como a origem HTTPS pública da API. Habilite `WHATSAPP_ENABLED=true` e reinicie a API.
3. No Sandbox da Vonage, informe os callbacks da API publicada, `/api/whatsapp/webhook` e `/api/whatsapp/webhook/status`. O processo principal `npm start` atende esses caminhos. Os callbacks precisam de assinatura JWT habilitada na Vonage.
4. Publique o site com `VITE_API_URL` apontando para a API publicada, incluindo `/api`. Gere a nova beta Android com `EXPO_PUBLIC_API_URL` apontando para essa mesma API e distribua-a na faixa de testes da Play Store.
5. Cada participante deve aderir ao Sandbox da Vonage e vincular o próprio número em uma conta PoupEazy. Confira com duas contas o registro após `sim`, os quatro relatórios e o isolamento dos dados. O Sandbox tem limite compartilhado de 100 mensagens por mês.

O gerador de PNG usa fontes incluídas no backend. Se uma imagem chegar com os cartões visíveis e o texto ausente, confirme no Render que o deploy inclui a [correção de fontes](https://github.com/Wesley-GLR/PoupEazy_BackEnd/pull/3) e peça um novo relatório no WhatsApp. A correção de fontes dispensa migração e nova build do app.

As imagens dos relatórios ficam na memória de uma instância da API por dez minutos. Reiniciar a instância antes de a Vonage buscar a imagem pode interromper sua entrega. Para a demonstração com gráficos, mantenha uma instância atendendo o webhook e a mídia na mesma origem. O envio em texto funciona quando `VONAGE_MEDIA_BASE_URL` está vazio.

Na beta acadêmica, o mobile inclui os conectores Sandbox do Pluggy também em builds de distribuição. Selecione Pluggy Bank e use `user-ok` e `password-ok` para conectar dados fictícios.

## Preparar o ambiente de teste da Meta

1. No [Meta for Developers](https://developers.facebook.com/apps), crie um aplicativo com o caso de uso **Conectar-se com clientes pelo WhatsApp**. Use o número de teste disponibilizado em **Configuração da API**.
2. Cadastre e verifique no campo **Para** o celular que vai conversar com o bot na apresentação. No painel, envie a mensagem de teste e responda pelo celular para confirmar o acesso. O número comercial da equipe pode continuar no WhatsApp Business.
3. Copie `.env.example` para `.env` no backend, mantendo `DATABASE_URL` local. Gere um `JWT_SECRET` aleatório para esse ambiente e configure os campos a seguir.

| Variável | Onde obter |
| --- | --- |
| `WHATSAPP_ENABLED` | Defina como `true`. |
| `WHATSAPP_PHONE_NUMBER_ID` | **Phone number ID** do remetente de teste em **Configuração da API**. |
| `WHATSAPP_BOT_NUMBER` | Número internacional do remetente de teste, só dígitos. É o destino do link `wa.me`. |
| `WHATSAPP_TEST_RECIPIENT_BR` | Opcional. Celular brasileiro verificado na lista de teste, no formato 55 + DDD + celular com o nono dígito, só números. Use se a Meta receber mensagens desse número e recusar as respostas com o erro 131030. |
| `WHATSAPP_ACCESS_TOKEN` | Token temporário em **Configuração da API**. Gere um novo se expirar antes da apresentação. |
| `WHATSAPP_APP_SECRET` | **Segredo do aplicativo** em **Configurações do app → Básico**. |
| `WHATSAPP_VERIFY_TOKEN` | Valor aleatório criado pela equipe, igual no `.env` e na confirmação do webhook na Meta. |
| `WHATSAPP_API_VERSION` | Versão da Graph API indicada no painel. O exemplo usa `v23.0`. |

Mantenha os segredos no `.env` local. Para gerar um valor aleatório para o JWT ou para a verificação do webhook, execute `node -p "require('node:crypto').randomBytes(24).toString('hex')"` uma vez para cada campo.

O número oficial de teste e os destinatários verificados permitem ensaiar pelo fluxo de testes da Meta. O bot só responde a mensagens recebidas, e a Meta informa que mensagens de atendimento são gratuitas. O HTTPS temporário é fornecido pelo Quick Tunnel. [Início rápido da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) · [Preços do WhatsApp](https://whatsappbusiness.com/products/platform-pricing/) · [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

## Subir o site, a API e o webhook

No diretório do backend, com Docker e Node 20+ instalados:

```bash
docker compose up -d --wait db
npm ci
npm run db:init
npm start
```

Use um banco de demonstração com contas fictícias. Para um banco já criado, a migration específica está em `db/migrations/005_whatsapp.sql`; o comando `db:init` já inclui essas tabelas no schema local.

Em outro terminal, ainda no backend:

```bash
node scripts/whatsapp-webhook.js
```

Com `cloudflared` instalado, abra um túnel para a porta **3002**, onde roda apenas o webhook:

```bash
cloudflared tunnel --url http://127.0.0.1:3002
```

Copie o endereço HTTPS exibido. Se estiver usando a Meta, em **WhatsApp → Configuração**, configure a URL de callback acrescentando `/api/whatsapp/webhook`, informe o `WHATSAPP_VERIFY_TOKEN` e assine o campo `messages` para a conta WhatsApp Business de teste. O endereço muda se o Quick Tunnel for reiniciado.

No repositório do site, abra `frontend`, configure `VITE_API_URL=http://localhost:3001/api` no `.env` e rode:

```bash
npm ci
npm run dev
```

## Roteiro da apresentação

1. Crie uma conta de teste no site local. Abra **Transações → Registrar via WhatsApp → Gerar link de vínculo**.
2. Abra o link e envie a mensagem preparada pelo celular autorizado no provedor escolhido. No PoupEazy, clique em **Já enviei a mensagem**.
3. No WhatsApp, mande `cabelo 35` e responda `sim`. O gasto usa a categoria **Outros** e a data da mensagem no horário de Brasília. Também funcionam `35 cabelo`, `café R$ 12,50` e valores com ponto nos centavos.
4. Reabra ou atualize **Transações** e mostre a despesa com a etiqueta **WhatsApp**. Mostre `cancelar` em uma segunda despesa para demonstrar que só o gasto confirmado entra no extrato.
5. Envie `relatório semanal` para receber entradas, gastos, saldo do período e as três categorias com maior gasto. A Vonage envia o gráfico em PNG quando a URL de mídia está configurada. Nos demais casos, o bot envia barras em texto. Também há `relatório diário`, `relatório mensal` e `relatório total`. Semana e mês seguem o calendário local e o resumo soma transações confirmadas até hoje.
6. Para usar outro celular com a mesma conta, use **Desvincular** e gere outro link.

## Segurança e verificação

- O vínculo exige login no PoupEazy, usa um código aleatório de uso único que expira em 10 minutos e guarda apenas o hash. Cada conta tem um número vinculado, e cada número pertence a uma conta.
- O webhook valida o HMAC do corpo bruto e o identificador do número destinatário. Relatórios e despesas usam a identidade do vínculo, e a API de transações continua filtrando por usuário.
- O rascunho vence em 15 minutos, e a confirmação e o registro ficam na mesma transação SQL. O identificador da mensagem evita duplicar gastos em caso de reenvio.
- `npm test` cobre interpretação de valores e calendário. Para incluir a integração com PostgreSQL e transporte simulado, aponte `WHATSAPP_TEST_DATABASE_URL` para um banco de teste que permita criar schemas e rode `npm test` novamente. O teste verifica assinatura, autenticação, expiração, confirmação, cancelamento, repetição de webhook, falha temporária no envio e isolamento de contas.
- No ensaio pelo celular, confira o token antes de apresentar. Se o webhook responder à verificação, mas as mensagens não chegarem, confira a assinatura do campo `messages`, o número destinatário verificado e se o túnel continua na mesma URL.
