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
```

Nao commite `.env`.

## Comandos

- `/start` - mensagem curta de boas-vindas.
- `/help` - exemplos de mensagens.
- `/resumo` - resumo do mes atual via `GET /monthly-summary`.
- `/categorias` - lista as categorias cadastradas na API.
- `/cancelar` - cancela uma operacao guiada pendente.
- `/menu` - mostra o menu principal.

O bot tambem configura o menu nativo de comandos do Telegram e envia um teclado
persistente com as principais funcoes:

- `Lancar transacao`
- `Resumo`
- `Categorias`
- `Cancelar`
- `Ajuda`

## Cadastro de transacoes

Formatos aceitos:

```txt
gasto 32.90 almoço alimentação
receita 1200 freela trabalho
32.90 almoço
```

Regras:

- `gasto` vira `expense`.
- `receita` vira `income`.
- A segunda palavra e o valor.
- O restante vira descricao.
- Se a ultima palavra bater com uma categoria existente, essa categoria e usada.
- O bot tambem tenta encontrar o nome exato da categoria em qualquer ponto da descricao.
- Se nao houver categoria correspondente, o bot mostra botoes inline para escolher uma categoria ou seguir sem categoria.
- Se a mensagem tiver valor e descricao, mas nao tiver tipo, o bot mostra botoes inline para escolher entre gasto e receita.
- Todas as transacoes criadas pelo bot usam `source: "telegram"`.
- A lista de categorias fica em cache por um periodo curto para evitar chamar a API em toda mensagem.
- A confirmacao inclui tipo, valor, descricao, categoria resolvida e data.

## Logs e erros

Os logs sao emitidos como JSON em stdout, com evento, nivel e metadados
operacionais. O bot nao loga token, senha, texto bruto da mensagem ou payload
financeiro completo.

Erros de API sao traduzidos para mensagens mais acionaveis, como falha de
conexao, falha de autenticacao, validacao rejeitada pela API ou erro interno.

## Sessao do chat

O bot mantem apenas estado temporario em memoria para operacoes guiadas. Se o
usuario ficar um dia sem interagir, a proxima mensagem reinicia a sessao do bot,
limpa operacoes pendentes e mostra o menu novamente. O historico do Telegram nao
e apagado, pois bots nao controlam o historico local do usuario.

## Rodar

Com a API local rodando:

```bash
npm run start
```

Validar tipos:

```bash
npm run typecheck
```
