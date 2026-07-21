# Saint Jardin — Automação de atendimento

Automação do primeiro atendimento de noivas no WhatsApp para o Saint Jardin Eventos
(espaço de casamentos com hospedagem), mais integração de calendário e envio de documentos.

Cliente/contato principal: **Raquel** (atendimento e gestão).
Responsável técnico: **Matheus**.

## Índice

### 01 — Descoberta
- [Reunião de 21/07/2026](01-descoberta/reuniao-2026-07-21.md) — transcrição da call e resumo das decisões
- [Material do WhatsApp](01-descoberta/material-whatsapp.md) — fluxo de atendimento atual, textos prontos, pacotes, preços, calendário
- [Transcrições dos áudios](01-descoberta/transcricoes-audios.md) — os 5 áudios enviados pela Raquel/Matheus

### 02 — Spec
- [MVP Fase 1](02-spec/mvp-fase-1.md) — chatbot de primeiro atendimento

### 03 — ADRs (decisões de arquitetura)
- [ADR-0001 — API do WhatsApp](03-adr/0001-whatsapp-api.md)
- [ADR-0002 — Calendário dedicado para disponibilidade](03-adr/0002-calendario-dedicado.md)
- [ADR-0003 — Dados estruturados desde o dia 1](03-adr/0003-dados-estruturados-plataforma.md)
- [ADR-0004 — Arquitetura do sistema](03-adr/0004-arquitetura.md)

## Estado atual

Descoberta e arquitetura concluídas. **Fase 0 e Fase 1 implementadas** (ver [README](../README.md)):
núcleo do agente em sandbox com testes, mais a camada de WhatsApp (webhook Cloud API, assinatura,
fila com delay, transcrição Groq, alerta Telegram, repos Supabase). 27 testes verdes, build ok.
Decisões travadas em 21/07: API oficial + coexistência, mesmo número, identificação por banco,
sem painel no MVP, persona "Raquel", preço só via PDF.

Falta o **setup externo** (projeto Supabase, número de teste da Meta, bucket de PDFs, deploy) para
exercitar de ponta a ponta. Próximo depois disso: Fase 2 (watchdog, consentimento LGPD, go-live).

## Material original

O export do WhatsApp (PDFs, fotos e áudios `.opus`) está em
`~/Downloads/WhatsApp Chat - Saint Jardin`. O `_chat.txt` foi copiado para
`01-descoberta/material-original/`; as transcrições dos áudios estão em
[transcricoes-audios.md](01-descoberta/transcricoes-audios.md). Os binários pesados
(PDFs, fotos, `.opus`) não entram no repo.
