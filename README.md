# MR Pizzaria — Sistema de Delivery v1

Primeira versão centralizada do sistema de pedidos da MR Pizzaria. Ela substitui o armazenamento exclusivo no navegador por um banco JSON persistente no servidor e mantém compatibilidade com o conector de impressão em papel de 80 mm.

## O que já funciona

- painel com pedidos em `Novo`, `Aceito`, `Em preparo`, `Pronto`, `Saiu para entrega`, `Finalizado` e `Cancelado`;
- pedidos de entrega e retirada;
- cadastro automático de clientes e histórico de endereços;
- cardápio atual da MR Pizzaria, pizzas, bordas e taxa de entrega de R$ 7,00;
- pedido manual pelo painel;
- entrada de pedido confirmado pelo robô do WhatsApp;
- fila automática separada para pizzaria e cozinha;
- proteção por chaves diferentes para painel, impressora e integração do WhatsApp;
- relatório diário, faturamento, ticket médio e itens mais vendidos;
- importação do backup JSON gerado pelo painel antigo;
- estrutura do pedido preparada para o futuro módulo de mesas.

## Instalação local

1. Instale o Node.js 20 ou superior.
2. Copie `.env.example` para `.env`.
3. Troque as três chaves no arquivo `.env`.
4. No terminal, dentro da pasta do projeto, execute:

```bash
npm start
```

O servidor não usa pacotes externos; não é necessário executar `npm install`.

5. Abra `http://localhost:3000/admin`.

Em desenvolvimento, quando `NODE_ENV` não é `production` e as chaves não foram configuradas, as rotas podem funcionar sem autenticação. Para uso real, configure todas as chaves.

## Publicação no Render

O arquivo `render.yaml` já descreve o serviço, cria um disco persistente de 1 GB e aponta o banco para `/var/data/mr-delivery.json`.

1. Envie esta pasta para um repositório GitHub.
2. No Render, crie um Blueprint usando o repositório.
3. Depois da criação, abra as variáveis do serviço e copie:
   - `ADMIN_API_KEY` para entrar no painel;
   - `PRINT_API_KEY` para configurar a impressora;
   - `WHATSAPP_INTERNAL_KEY` para o robô do WhatsApp.
4. Não exponha essas chaves em mensagens, imagens ou arquivos públicos.

## Ligação com o robô do WhatsApp

No final do fluxo, depois que o cliente confirmar o pedido, o robô deve enviar um `POST` para:

```text
/api/integrations/whatsapp/orders
```

Cabeçalho obrigatório:

```text
x-whatsapp-key: valor de WHATSAPP_INTERNAL_KEY
```

O arquivo `integracao_whatsapp_exemplo.js` contém a função pronta. No projeto do robô, configure:

```env
DELIVERY_API_URL=https://endereco-do-sistema.onrender.com
WHATSAPP_INTERNAL_KEY=a-mesma-chave-do-sistema
```

O retorno contém o número central do pedido. Use `result.order.number` na mensagem de confirmação enviada ao cliente.

## Impressora

Na pasta `impressor`:

1. execute `1_CONFIGURAR.bat`;
2. informe o endereço do sistema no Render;
3. escolha a impressora instalada no Windows;
4. informe a `PRINT_API_KEY`;
5. execute `2_TESTAR_IMPRESSAO.bat`;
6. execute `3_INICIAR_IMPRESSOR.bat` para começar a consultar pedidos.

O conector salva localmente as comandas já impressas antes de confirmar ao servidor, reduzindo o risco de duplicidade quando a internet cai.

## Importação do painel antigo

No painel antigo, clique em **Exportar pedidos** e salve o arquivo JSON. No novo painel, abra **Relatórios → Importar histórico antigo**, escolha o arquivo e confirme.

A importação cria novos números centrais. O conteúdo dos pedidos é mantido, mas a numeração antiga não é reutilizada para evitar conflito.

## Próxima etapa: atendimento das mesas

A base já reconhece `TABLE`, `tableNumber`, `waiterName` e origem `MESA`. A próxima versão deve acrescentar mapa de mesas, comandas abertas, lançamentos por garçom, divisão da conta, fechamento e caixa, reutilizando o mesmo cardápio e a mesma impressão.

## Observação sobre o banco

O banco JSON é adequado para a primeira versão de uma unidade, executando apenas uma instância do servidor e usando disco persistente. Antes de expandir para várias lojas ou grande volume simultâneo, a camada `src/store.js` deve ser trocada por PostgreSQL sem alterar as telas nem o formato dos pedidos.
