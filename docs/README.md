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

Fase de descoberta concluída. Aguardando decisões pendentes da Raquel (ver seção
"Decisões pendentes" na [spec do MVP](02-spec/mvp-fase-1.md)) antes de iniciar o desenvolvimento.

## Material original

O export do WhatsApp (PDFs, fotos e áudios `.opus`) está em
`~/Downloads/WhatsApp Chat - Saint Jardin`. O `_chat.txt` foi copiado para
`01-descoberta/material-original/`; as transcrições dos áudios estão em
[transcricoes-audios.md](01-descoberta/transcricoes-audios.md). Os binários pesados
(PDFs, fotos, `.opus`) não entram no repo.
