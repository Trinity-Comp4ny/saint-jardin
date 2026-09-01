# ADR-0007 — Transcrição de áudio via Gemini, não Groq/Whisper

**Status:** aceito
**Data:** 01/09/2026
**Relaciona:** [ADR-0004](./0004-arquitetura.md) (arquitetura original, indicava Groq Whisper)

## Contexto

A implementação original da transcrição de áudio (ADR-0004) usava Whisper large-v3 hospedado no Groq: um
segundo provedor de LLM/infra além do Gemini, já usado para o NLU e o Redator. Na prática isso significa
uma segunda chave (`GROQ_API_KEY`), um segundo painel de billing, um segundo ponto de falha e uma segunda
política de dados para acompanhar (LGPD/DPA).

O Matheus decidiu consolidar em um único provedor de LLM. A alternativa: os modelos Gemini aceitam áudio
como input multimodal (`inlineData` em `generateContent`, até 20MB por request — os áudios de WhatsApp, na
casa de segundos a poucos minutos, ficam bem abaixo disso), então dá para transcrever sem sair do Gemini.

## Decisão

Trocar `GroqTranscriber` por `GeminiTranscriber` (`src/adapters/GeminiTranscriber.ts`), implementando o
mesmo port `Transcriber` (`src/ports/index.ts`). Baixa a mídia da Meta do mesmo jeito (2 requests com
`mediaId`, reaproveitado do adapter anterior), mas manda o áudio para o `gemini-flash-lite-latest` (o mesmo
modelo do NLU) com um prompt fechado: transcrição literal, sem resumir, sem corrigir gramática, sem
comentários. `GEMINI_API_KEY` passa a ser a única chave de LLM do projeto — `GROQ_API_KEY` sai do
`.env.example` e do resto do código.

## Consequências

- Um único provedor de LLM para todo o projeto: menos superfície de configuração, um DPA/LGPD só, um
  painel de billing só.
- Risco assumido conscientemente: um modelo generalista (Gemini) tende a "corrigir"/parafrasear a fala em
  vez de transcrever 100% literal, diferente de um ASR dedicado (Whisper). Como a transcrição alimenta um
  NLU que extrai dados objetivos (data, nº de convidados), isso é o ponto mais provável de precisar
  revisão se o comportamento em produção não for satisfatório — decisão a reavaliar com uso real, sem
  reabrir Groq/Whisper como primeira alternativa (voltaria a ter 2 provedores).
- Sem mudança no comportamento de falha: continua best-effort (ver o handoff automático em
  `processarFila` quando a transcrição lança), agora citando "Gemini indisponível" em vez de "Groq" nos
  comentários.
