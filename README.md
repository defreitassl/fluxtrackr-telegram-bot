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

## Experiencia de uso

As mensagens do bot usam formatacao HTML do Telegram, com titulo curto, emoji
contextual e proximo passo explicito. Exemplos de mensagens aparecem como
codigo para facilitar leitura no celular.

Fluxos guiados devem deixar claro o que o usuario precisa fazer:

- Ao tocar em `🔴 Lançar gasto`, o bot pede apenas valor, descricao e categoria.
- Ao tocar em `🟢 Lançar entrada`, o bot pede apenas valor, descricao e categoria.
- Se o usuario enviar uma transacao sem tipo, o bot pergunta se e gasto ou entrada.
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

Esse reset depende do bot estar rodando no momento da virada do dia. O Telegram
tambem limita exclusao de mensagens antigas, entao mensagens que o bot nao
conhece ou nao pode mais excluir podem permanecer no historico.

## Rodar

Com a API local rodando:

```bash
npm run start
```

Validar tipos:

```bash
npm run typecheck
```
