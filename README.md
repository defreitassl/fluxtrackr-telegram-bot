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

## Cadastro de transacoes

Formatos aceitos:

```txt
gasto 32.90 almoço alimentação
receita 1200 freela trabalho
```

Regras:

- `gasto` vira `expense`.
- `receita` vira `income`.
- A segunda palavra e o valor.
- O restante vira descricao.
- Se a ultima palavra bater com uma categoria existente, essa categoria e usada.
- Se nao houver categoria correspondente, a transacao e salva sem categoria.
- Todas as transacoes criadas pelo bot usam `source: "telegram"`.

## Rodar

Com a API local rodando:

```bash
npm run start
```

Validar tipos:

```bash
npm run typecheck
```
