# MR Pizzaria — WhatsApp + Mesas v6.4.1

Sistema integrado para atendimento por WhatsApp, pedidos pelo site e atendimento no salão.

## v6.4.1 — retorno automático após pagamento Pagar.me

- O Checkout Pagar.me abre em uma nova janela/aba, mantendo o site da MR Pizzaria aberto.
- Enquanto o cliente paga, o site consulta o status do pedido a cada 2 segundos.
- Quando o webhook confirma o pagamento, o site tenta fechar a janela do checkout, recupera o foco e mostra **Pagamento aprovado**.
- A consulta pública de status exige o ID aleatório do link Pagar.me e não expõe dados do cliente.
- Em produção, o Pixel dispara `Purchase_order_<número>` após a confirmação para deduplicar com a CAPI do webhook.
- Pagamentos recusados/cancelados/estornados são exibidos na tela e permitem reabrir o checkout.
- Pedidos online ainda não pagos não exibem botões de impressão no painel; o endpoint de impressão continua bloqueando como segunda camada.
- Se o navegador bloquear a nova aba, há fallback para abrir o Pagar.me na mesma aba.


## Novidades da versão 6.3.6

- Checkout do site separado em **2 etapas**: primeiro dados do pedido; depois forma de pagamento.
- O pedido **não entra no painel** antes da escolha de pagamento e do clique final em **Confirmar pedido**.
- Formas disponíveis nesta etapa: **Crédito, Débito, Pix e Dinheiro**. Para pedidos lançados pelo garçom, permanece **Conta da mesa**.
- Crédito/débito/Pix ficam identificados como **pagamento no local**; nenhuma cobrança online é iniciada nesta versão.
- Após confirmar, o cliente vê a forma escolhida e um botão **Receber atualizações no WhatsApp** para iniciar a conversa e liberar mensagens de acompanhamento.
- Mudanças de status no painel agora normalizam o telefone, tentam enviar a mensagem e mostram no painel se o WhatsApp foi enviado ou recusado.
- Suporte a template utilitário de status via `WHATSAPP_STATUS_TEMPLATE`, usado como fallback quando a conversa de atendimento do WhatsApp não está aberta.
- Preparação para a próxima fase: integração com adquirente/maquininha para pagamento online.

### Template recomendado para status do pedido

Crie no WhatsApp Manager um template utilitário aprovado com duas variáveis no corpo, por exemplo:

`Atualização do pedido nº {{1}}: {{2}}.`

Depois configure no Render:

- `WHATSAPP_STATUS_TEMPLATE=nome_do_template_aprovado`
- `WHATSAPP_STATUS_TEMPLATE_LANGUAGE=pt_BR`

Sem esse template, mensagens livres de status continuam funcionando quando o cliente iniciou uma conversa recente com o WhatsApp da pizzaria.

## Novidades da versão 6.3.0

- Nova área **Combos em destaque** no site, separada das promoções do dia.
- Painel **/admin/combos** para cadastrar, editar, ordenar, ativar/desativar e excluir combos sem alterar código.
- Os combos entram normalmente no carrinho, pedido e impressão da cozinha.
- Integração com **Meta Pixel** para campanhas do Facebook e Instagram usando a variável `META_PIXEL_ID`.
- Eventos configurados: `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout` e `Purchase` (pedido confirmado).
- Banner de consentimento: o Pixel só inicia depois que o cliente aceita a medição de marketing.
- Política de privacidade atualizada para informar a medição de campanhas.

### Ativar o Meta Pixel

1. No Gerenciador de Eventos da Meta, crie ou abra a fonte de dados da Web/Pixel.
2. Copie somente o número do ID do Pixel/Dataset.
3. No Render, em **Environment**, crie `META_PIXEL_ID` com esse número.
4. Faça um novo deploy.
5. Abra o site em janela anônima, aceite o banner e teste no Gerenciador de Eventos/Meta Pixel Helper.

Se `META_PIXEL_ID` ficar vazio, o site funciona normalmente sem carregar o Pixel.

### Cadastrar combos

Acesse `/admin/combos`. Cada combo possui nome, descrição, preço, ordem e status. Combos ativos aparecem automaticamente acima do cardápio.

## Correção do PDF no WhatsApp

- O PDF agora é enviado primeiro para a biblioteca de mídia da Meta e depois encaminhado pelo `media_id`.
- O sistema não depende mais apenas de a Meta baixar o PDF por uma URL externa.
- Depois do anexo, o cliente também recebe uma mensagem de confirmação com um link alternativo.
- O webhook registra no Render os estados `sent`, `delivered`, `read` e `failed`, incluindo o erro devolvido pela Meta.
- O endereço público usa automaticamente `RENDER_EXTERNAL_URL` quando `PUBLIC_BASE_URL` não estiver preenchido.

## O que entrou nesta versão

- Cardápio completo em PDF incluído no pacote.
- Opção **12 — Baixar cardápio em PDF** no atendimento do WhatsApp.
- O WhatsApp envia o PDF por `media_id`; se o anexo falhar, também tenta por URL e sempre envia o link de download.
- Botões **Baixar cardápio em PDF** no site de pedidos.
- Rotas públicas `/cardapio-mr-pizzaria.pdf`, `/cardapio.pdf`, `/cardapio-pdf` e `/baixar-cardapio`.
- Mapa com 17 mesas.
- Várias comandas individuais por mesa, com códigos automáticos como `M05-C01`.
- Abertura, solicitação de conta, reabertura e fechamento de comandas.
- Lançamento de novos pedidos diretamente dentro da comanda.
- Impressão do pedido por setor e impressão consolidada da comanda.
- Cadastro livre de funcionários: garçom, caixa, cozinha, gerente e administrador.
- Nome do garçom, mesa e comanda gravados em cada pedido.
- Pedidos do salão podem ser lançados na forma de pagamento `Conta da mesa`.
- Backup administrativo inclui pedidos, comandas e equipe.

## Cardápio cadastrado

### Alterações da versão 6.2.4

- Removida a pizza **Strogonoff de frango**.
- Mantida a pizza especial **Strogonoff de carne**, com batata palha.
- Incluídas as porções **Alcatra acebolada**, **Picanha acebolada** e **Filé de frango acebolado**.
- Cardápio de drinks substituído pelas novas opções Dona Onça, Dona Onça 2.0, batidas, caipirinhas, Espanhola, Limonet, Tombadinha, Esqueci Meu CPF e Congela Coração.
- No sistema, as bebidas com escolha de destilado aparecem separadas por **Vodka** e **Velho Barreiro**, para evitar erro de preço no pedido.
- Coca-Cola e Coca-Cola Zero atualizadas para R$ 6,00.
- Pizzas doces com os mesmos preços das tradicionais: P R$ 60, M R$ 70 e G R$ 80.
- Petit gâteau restaurado por R$ 18,00.
- Restaurados X-Bacon salada, X-Frango e X-Egg; incluído X-Calabresa.
- Removidas as pizzas doces **Brigadeiro**, **Sensação**, **Romeu e Julieta** e **Beijinho**.
- Removido o ingrediente **granulado** de todas as pizzas doces restantes.
- O PDF do cardápio foi recriado com 8 páginas e incluído no pacote.
- Corrigido o drink **Esqueci Meu CPF** para incluir vodka nos ingredientes.
- Incluída a porção **Costelinha barbecue**, acompanhada de arroz, por **R$ 149,90**.

### Pizzas

Tradicionais: pequena R$ 60,00, média R$ 70,00 e grande R$ 80,00.

Especiais: pequena R$ 80,00, média R$ 90,00 e grande R$ 100,00.

O preço da pizza meio a meio continua proporcional aos sabores escolhidos.

## Endereços do sistema

- Pedido online: `/comprar`
- Cardápio PDF: `/cardapio-mr-pizzaria.pdf`
- Download direto do PDF: `/baixar-cardapio`
- Painel principal: `/admin`
- Mesas: `/admin/mesas`
- Equipe: `/admin/equipe`
- Reservas: `/admin/reservas`
- Promoções: `/admin/promocao`
- Combos em destaque: `/admin/combos`
- Backup: `/admin/export.json`

## Instalação no Render

1. Substitua os arquivos do projeto atual por estes arquivos.
2. Envie as alterações ao GitHub conectado ao Render.
3. Aguarde o novo deploy.
4. Mantenha as variáveis de ambiente já cadastradas, principalmente `DATABASE_URL`, `ADMIN_KEY`, `PRINT_API_KEY`, `VERIFY_TOKEN`, `WHATSAPP_TOKEN` e `PHONE_NUMBER_ID`.
5. Em `PUBLIC_BASE_URL`, coloque a URL real do seu serviço. Também pode deixar a variável vazia: no Render o sistema usa automaticamente `RENDER_EXTERNAL_URL`.
6. Acesse `/cardapio-mr-pizzaria.pdf` e confira se o PDF abre normalmente.
7. Acesse `/admin/mesas` para começar a abrir as comandas.

A atualização cria automaticamente as novas tabelas e colunas no PostgreSQL. Os pedidos antigos permanecem no banco.

## Impressora

O conector da Bematech MP-4200 USB continua o mesmo. Não é necessário reinstalá-lo; a nova versão mantém a fila de impressão já utilizada.

## Observação sobre usuários

O cadastro de equipe e PIN está pronto. Nesta versão, o painel continua protegido pela senha administrativa geral (`ADMIN_KEY`). O login separado por PIN e as permissões individuais por função ficam preparados para uma próxima etapa.


## Recuperação de vendas (v6.3.2)
- O pop-up de Meta Pixel na entrada foi removido.
- A autorização de medição fica discretamente na finalização.
- O cliente pode autorizar um lembrete do carrinho pelo WhatsApp.
- Carrinhos autorizados aparecem em `/admin/recuperacao`.
- O botão de contato é liberado após `ABANDONED_CART_MIN_AGE_MINUTES` (padrão 10 min) sem atividade.
- Ao concluir o pedido, o carrinho é marcado como convertido.
- Carrinhos de recuperação são eliminados automaticamente após 30 dias por padrão (`ABANDONED_CART_RETENTION_DAYS`).


## v6.3.2
- Fotos em combos: `/admin/combos`.
- Relatórios: `/admin/relatorios`.
- Botão para zerar vendas de teste quando `TEST_MODE=true`.


## v6.3.3 — seleção de tamanho e sabores da pizza

- O tamanho da pizza aparece sozinho em uma linha.
- As opções seguintes só aparecem depois que o cliente escolhe o tamanho.
- Pizza pequena trabalha com 1 sabor.
- Pizza média e grande permitem escolher claramente entre **1 sabor** e **2 sabores**.
- Ao escolher 2 sabores, os dois campos aparecem lado a lado, cada um começando em **Nenhum**.
- Se o cliente escolher 1 sabor, o segundo campo fica oculto e não é exigido.
- Validação impede adicionar pizza sem tamanho/sabor ou com dois sabores iguais.


## v6.3.5 — lembrete de carrinho desmarcado por padrão

- A opção **Lembrete do carrinho** inicia desmarcada no checkout.
- O cliente pode marcar a opção voluntariamente para autorizar o lembrete pelo WhatsApp.
- Depois de concluir um pedido, a opção volta a ficar desmarcada.
- O cliente continua podendo marcar/desmarcar a opção antes de finalizar.

## Meta Conversions API (CAPI) — v6.4.0

Esta versão envia os eventos do site tanto pelo navegador (Meta Pixel) quanto pelo servidor (Conversions API), respeitando a autorização de medição do cliente.

Eventos integrados: `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout` e `Purchase`.

Para evitar dupla contagem, navegador e servidor usam o mesmo `event_id` em cada ação. O `Purchase` é confirmado no servidor somente depois que o pedido é salvo com sucesso.

Variáveis no Render:

- `META_PIXEL_ID` — ID do Pixel / conjunto de dados.
- `META_CAPI_ACCESS_TOKEN` — token da API de Conversões. Nunca coloque este token no HTML ou GitHub.
- `META_GRAPH_API_VERSION` — opcional; padrão `v25.0` ou o valor de `GRAPH_API_VERSION`.
- `META_CAPI_TEST_EVENT_CODE` — opcional e temporário para a tela Eventos de teste. Remova após validar.

Endpoint de diagnóstico sem segredo: `/api/meta/capi/status`.

### Teste recomendado

1. No Gerenciador de Eventos, abra `Eventos de teste` e copie o `test_event_code`.
2. Coloque temporariamente esse valor em `META_CAPI_TEST_EVENT_CODE` no Render e faça deploy/restart.
3. Abra o site, autorize a medição e navegue pelo funil até uma compra de teste.
4. Confirme que os eventos aparecem com origem `Navegador` e `Servidor` e que a Meta indica deduplicação.
5. Apague `META_CAPI_TEST_EVENT_CODE` e reinicie o serviço para voltar à operação normal.


## Pagar.me — pagamento online (v6.4.0)

O checkout do site agora oferece:
- Pix online pelo Checkout hospedado Pagar.me;
- cartão de crédito online em 1x pelo Checkout hospedado Pagar.me;
- Pix, crédito, débito e dinheiro no local;
- pedidos online ficam `Aguardando pagamento` e NÃO entram na fila de impressão até o webhook confirmar o pagamento;
- `order.paid` libera o pedido automaticamente como `Novo`;
- falha/cancelamento/estorno atualizam o pedido e bloqueiam a impressão;
- Meta CAPI `Purchase` de pagamento online é disparado apenas após confirmação do pagamento real, apenas em produção e quando houve consentimento de marketing; pagamentos simulados do Pagar.me não poluem as conversões da Meta.

### Variáveis no Render

```env
PAGARME_SECRET_KEY=sk_test_...
PAGARME_BASE_URL=https://sdx-api.pagar.me/core/v5
PAGARME_ENV=test
PAGARME_PAYMENT_LINK_EXPIRES_MINUTES=30
PAGARME_WEBHOOK_TOKEN=gere_um_token_longo_e_aleatorio
```

### Webhook no Dashboard Pagar.me
Cadastre a URL abaixo (HTTPS):

```text
https://SEU-SITE.onrender.com/webhooks/pagarme?token=SEU_TOKEN
```

Eventos recomendados: `order.paid`, `order.payment_failed`, `order.canceled`, `checkout.canceled`, `charge.refunded`.

### Teste de cartão
Use somente no ambiente de teste do Pagar.me. A documentação oficial informa:
- aprovado: `4000000000000010`;
- recusado: `4000000000000028`;
- CVV: 3 dígitos quaisquer; validade: data futura.

Antes da produção, troque a Secret Key e a base URL para produção e mantenha `PAGARME_WEBHOOK_TOKEN` configurado.
