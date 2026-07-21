# saint-jardin

Automação de atendimento para o Saint Jardin Eventos (espaço de casamentos com hospedagem):
chatbot de primeiro atendimento no WhatsApp, integração de calendário e envio de documentos.

Documentação em [`docs/`](docs/README.md). Arquitetura no
[ADR-0004](docs/03-adr/0004-arquitetura.md).

## Estado

**Fase 0 (fundação, sem WhatsApp): concluída.** Núcleo do agente rodando ponta a ponta em modo
sandbox, com testes. Próxima: Fase 1 (canal WhatsApp em sandbox). Ver
[roadmap](docs/03-adr/0004-arquitetura.md#roadmap-incremental).

## Como rodar

```bash
npm install
npm test          # testes da máquina de estados e do orquestrador
npm run sandbox   # demonstração de conversas (sem WhatsApp)
npm run sandbox -- --repl   # modo interativo: você digita como a noiva
npm run typecheck
```

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
  app/
    orchestrator.ts  coordena identificação, NLU, disponibilidade, decisão e efeitos
  sandbox/
    run.ts           CLI de demonstração e modo interativo
test/              testes (vitest)
supabase/migrations/  schema inicial (Fase 1 em diante)
```

## Princípios

- O **cérebro é determinístico** (máquina de estados em TS): cada ramo é testável sem LLM nem WhatsApp.
- O **LLM só lê** a mensagem (extrai dados, classifica intenção). Não decide o fluxo nem inventa preço.
- **Portas e adapters**: trocar WhatsApp/calendário/banco não toca o núcleo.
