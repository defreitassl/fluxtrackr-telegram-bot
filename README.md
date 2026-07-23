# Telegram Bot

Bot privado do FluxTrackr para cadastro rapido de transacoes.

## Funcao

O bot e uma alternativa rapida ao app mobile para cadastrar transacoes do dia a dia. Ele nao acessa o banco diretamente: faz login na API NestJS e usa os endpoints HTTP do backend.

## Configuracao

Crie `.env`:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_USER_ID=
API_BASE_URL=http://localhost:3001
BOT_USER_EMAIL=dev@fluxtrackr.local
BOT_USER_PASSWORD=123456
PORT=3000
WEBHOOK_BASE_URL=https://seu-bot.up.railway.app
TELEGRAM_WEBHOOK_PATH=/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=
```

Nao commite `.env`.

`BOT_USER_EMAIL` e `BOT_USER_PASSWORD` sao obrigatorios. `API_BASE_URL` pode
usar HTTP apenas em `localhost`/`127.0.0.1`; fora do desenvolvimento local, use
HTTPS.

`WEBHOOK_BASE_URL` deve usar HTTPS e nao pode terminar com `/`.
`TELEGRAM_WEBHOOK_PATH` deve iniciar com `/` e, no deploy padrao, usa
`/telegram/webhook`. `TELEGRAM_WEBHOOK_SECRET` e obrigatorio: use um valor longo
e aleatorio, mantenha-o apenas nas variaveis seguras do Railway e nunca o
registre em logs. O Railway injeta `PORT` automaticamente; `3000` serve apenas
como valor local de exemplo.

Em producao, o bot usa o artefato compilado por `npm run build` e inicia com
`npm run start`. Ele recebe atualizacoes pelo webhook HTTPS nativo do Telegram,
em vez de long polling. Mantenha apenas uma replica para preservar os estados
temporarios em memoria do fluxo guiado.

## Comandos

- `/start` - mensagem curta de boas-vindas.
- `/help` - exemplos de mensagens.
- `/resumo` - resumo do mes atual via `GET /monthly-summary`.
- `/categorias` - lista as categorias cadastradas na API.
- `/cancelar` - cancela uma operacao guiada pendente.
- `/menu` - mostra o menu principal.

O bot tambem configura o menu nativo de comandos do Telegram e envia um teclado
persistente com as principais funcoes:

- `🔴 Lançar gasto`
- `🟢 Lançar entrada`
- `🔵 Resumo`
- `🟣 Categorias`
- `⚪ Cancelar`
- `❔ Ajuda`

Os estilos de cor dependem do suporte do cliente Telegram. Os emojis permanecem
como fallback visual.

## Cadastro de transacoes

Formatos aceitos:

```txt
gasto 32.90 almoço alimentação
gasto R$ 32,90 almoço alimentação
receita 1200 freela trabalho
32.90 almoço
32.90
```

Regras:

- `gasto` vira `expense`.
- `receita` vira `income`.
- O valor aceita formatos como `32.90`, `32,90`, `R$ 32,90` e `1.234,56`.
- O restante vira descricao, mas a descricao e opcional.
- Se a ultima palavra bater com uma categoria existente, essa categoria e usada.
- O bot tambem tenta encontrar o nome exato da categoria em qualquer ponto da descricao.
- Se nao houver categoria correspondente, o bot mostra botoes inline para escolher uma categoria ou seguir sem categoria.
- Se a mensagem tiver valor e descricao, mas nao tiver tipo, o bot mostra botoes inline para escolher entre gasto e receita.
- Se a mensagem tiver apenas valor, o bot pergunta primeiro se e gasto ou entrada e depois pergunta a categoria.
- Todas as transacoes criadas pelo bot usam `source: "telegram"`.
- A lista de categorias fica em cache por um periodo curto para evitar chamar a API em toda mensagem.
- A confirmacao inclui tipo, valor, descricao, categoria resolvida e data.
- O bot responde apenas na conversa privada do `TELEGRAM_USER_ID` configurado.

## Experiencia de uso

As mensagens do bot usam formatacao HTML do Telegram, com titulo curto, emoji
contextual e proximo passo explicito. Exemplos de mensagens aparecem como
codigo para facilitar leitura no celular.

Fluxos guiados devem deixar claro o que o usuario precisa fazer:

- Ao tocar em `🔴 Lançar gasto`, o bot pede apenas valor, descricao e categoria.
- Ao tocar em `🟢 Lançar entrada`, o bot pede apenas valor, descricao e categoria.
- Descricao e opcional; quando nao vier, o bot registra `Sem descrição`.
- Se o usuario enviar uma transacao sem tipo, mesmo que seja apenas o valor, o bot pergunta se e gasto ou entrada.
- Se faltar categoria, o bot mostra botoes inline para escolher categoria, seguir sem categoria ou cancelar.
- Erros mostram uma causa resumida e uma acao sugerida, como tentar pelo menu ou abrir `/help`.

## Logs e erros

Os logs sao emitidos como JSON em stdout, com evento, nivel e metadados
operacionais. O bot nao loga token, senha, texto bruto da mensagem ou payload
financeiro completo.

Erros de API sao traduzidos para mensagens mais acionaveis, como falha de
conexao, falha de autenticacao, validacao rejeitada pela API ou erro interno.

## Sessao do chat

O bot mantem apenas estado temporario em memoria para operacoes guiadas. Todos
os dias a 00h, no horario local do processo, ele tenta apagar as mensagens
rastreadas do dia, limpa operacoes pendentes e envia um menu novo.

Esse reset depende do bot estar rodando no momento da virada do dia e so envia
um novo menu quando havia mensagens rastreadas no dia. O Telegram tambem limita
exclusao de mensagens antigas, entao mensagens que o bot nao conhece ou nao
pode mais excluir podem permanecer no historico.

## Rodar

Com a API local rodando:

```bash
npm run start
```

Validar tipos:

```bash
npm run typecheck
```

Rodar testes focados:

```bash
npm test
```

## Railway

O [`railway.json`](./railway.json) configura o build e reinicio em falha. O
servico do bot precisa de dominio publico HTTPS para o Telegram entregar as
atualizacoes. No painel do Railway, abra o servico do bot em **Settings > Public
Networking > Generate Domain**, copie o dominio HTTPS gerado e configure-o como
`WEBHOOK_BASE_URL`, sem a barra final. O Railway valida `GET /health` antes de
concluir o deploy; essa rota responde `200` com `{ "status": "ok" }`.

Configure tambem `API_BASE_URL` com o dominio HTTPS publico da API e
`TZ=America/Sao_Paulo` para manter a limpeza diaria no horario do Brasil.
Mantenha Serverless e Cron desativados e uma unica replica do servico.

Depois do deploy, consulte o estado do webhook sem exibir o token em logs:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

A URL retornada deve terminar em `/telegram/webhook`, `last_error_date` deve
estar ausente e `pending_update_count` deve permanecer proximo de zero. Para
rollback ao long polling, remova o webhook antes de restaurar a versao anterior:

```bash
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```

O passo a passo completo esta em
[`../docs/technical/railway-deployment.md`](../docs/technical/railway-deployment.md).
