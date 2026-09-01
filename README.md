# saint-jardin

Automação de atendimento para o Saint Jardin Eventos (espaço de casamentos com hospedagem):
chatbot de primeiro atendimento no WhatsApp, integração de calendário e envio de documentos.

Documentação em [`docs/`](docs/README.md). Arquitetura no
[ADR-0004](docs/03-adr/0004-arquitetura.md).

## Estado

- **Fase 0 (fundação, sem WhatsApp): concluída.** Núcleo do agente com testes.
- **Fase 1 (canal WhatsApp): implementada.** Webhook da Cloud API, validação de assinatura,
  fila com delay, transcrição de áudio (Gemini), alerta de handoff (Telegram) e repositórios Supabase.
  Falta o setup externo (número de teste da Meta, projeto Supabase, deploy) para exercitar de ponta a ponta.

Ver [roadmap](docs/03-adr/0004-arquitetura.md#roadmap-incremental).

## Como rodar

```bash
npm install
npm test          # 27 testes (núcleo + webhook)
npm run sandbox   # demonstração de conversas (sem WhatsApp)
npm run sandbox -- --repl   # modo interativo: você digita como a noiva
npm run typecheck
npm run dev       # sobe o app Next (webhook em /api/whatsapp, health em /api/health)
```

### Endpoints (Fase 1)

- `GET  /api/whatsapp` — handshake de verificação da Meta (usa `WHATSAPP_VERIFY_TOKEN`).
- `POST /api/whatsapp` — recebe mensagens (valida `x-hub-signature-256`, deduplica, enfileira).
- `POST /api/process` — processa a fila vencida (chamado pelo pg_cron; protegido por `x-process-secret`).
- `GET  /api/health` — status.

### Setup externo pendente para o go-live de teste

1. Projeto Supabase (região São Paulo); rodar as migrations em `supabase/migrations/`.
2. Bucket privado `propostas` no Supabase Storage com os 4 PDFs.
3. App na Meta (WhatsApp) + número de teste; configurar webhook apontando para a URL do deploy.
4. Bot do Telegram + `TELEGRAM_CHAT_ID`. Preencher `.env` (ver `.env.example`).
5. Agendar `/api/process` via pg_cron (ver `supabase/migrations/0002_fila.sql`).

## Estrutura do código

```
src/
  domain/        núcleo puro e testável
    types.ts         tipos e regras (limite mini wedding, dias, anos)
    persona.ts       persona "Raquel" + mensagens prontas (fonte única dos textos)
    pdfs.ts          catálogo de PDFs (o preço vive dentro do PDF)
    stateMachine.ts  máquina de estados determinística (o "cérebro" do fluxo)
  ports/         interfaces (NLU, WhatsApp, calendário, repositórios, notifier)
  adapters/
    MockNLU.ts       NLU determinística (testes + sandbox)
    AnthropicNLU.ts  NLU de produção (Claude Haiku, só leitura da mensagem)
    memory.ts        canal/repos/calendário/notifier em memória
  whatsapp/
    parseWebhook.ts    parser puro do payload da Meta
    verifySignature.ts validação da assinatura + handshake
  app/
    orchestrator.ts  coordena identificação, NLU, disponibilidade, decisão e efeitos
    pipeline.ts      ingestão do webhook -> fila (delay) -> processamento
    deps.ts          raiz de composição (monta adapters a partir do env)
  sandbox/
    run.ts           CLI de demonstração e modo interativo
app/                 rotas Next.js (webhook, process, health)
test/              testes (vitest)
supabase/migrations/  schema (contatos, conversas, fila, dedup, disponibilidade, LGPD)
```

## Princípios

- O **cérebro é determinístico** (máquina de estados em TS): cada ramo é testável sem LLM nem WhatsApp.
- O **LLM só lê** a mensagem (extrai dados, classifica intenção). Não decide o fluxo nem inventa preço.
- **Portas e adapters**: trocar WhatsApp/calendário/banco não toca o núcleo.
