# ADR-0003 — Dados estruturados desde o dia 1

**Status:** proposto
**Data:** 21/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md)

## Contexto

O destino do projeto (visão do Matheus na call, áudio 5) é uma **plataforma de administração
centralizada** (calendário + financeiro + banco + estoque), não fazer tudo pelo WhatsApp, porque
"tudo pelo WhatsApp pode dar BO e a gente não sabe rastrear". O MVP é o chatbot, mas ele já gera dados.

Hoje os dados vivem espalhados e não estruturados:
- Preços em **PDFs estáticos** (2027, 2028) e valores digitados na hora.
- Leads e histórico só no WhatsApp.
- Persona da atendente **inconsistente** ("Raquel" em uns contatos, "Ana" em outros).

Se o MVP nascer sem estrutura, a plataforma futura vai exigir retrabalho e migração.

## Decisão

Desde o MVP, tratar como **dados estruturados** (não só texto solto), pensando na plataforma futura:

1. **Preço vive dentro do PDF, não no sistema** — o agente **não calcula nem fala preço**, apenas
   roteia a conversa e envia o **PDF correto** (apresentação, proposta 2027, proposta 2028, mini wedding).
   Os PDFs são a fonte de preço; trocar valor = subir novo PDF, sem tocar no código. (Decisão do Matheus
   em 21/07: "o agente não vai falar preço, vai apenas mandar o PDF já com os valores".) Isso elimina o
   risco de a IA errar valor e simplifica o agente para um **roteador de conversa**.
2. **Base de leads/conversas** — cada lead com número, estado da conversa, data pretendida, nº de
   convidados, origem (Instagram/direto), timestamps. Habilita follow-up e, depois, o CRM da plataforma.
3. **Base de clientes fechados** — lista de números que a IA não deve atender (regra crítica da spec).
4. **Persona única** — nome fixado: **"Raquel"** (decisão do Matheus em 21/07), em config, reaproveitável.

Modelo de dados detalhado na [ADR-0004](0004-arquitetura.md).

## Consequências

- O MVP fica pronto para migrar para a plataforma sem perder histórico de leads.
- **Não** é preciso montar tabela de preços estruturada: os PDFs (2027 e 2028, ambos já com valores)
  são a fonte. Some da lista de pendências.
- Persona definida como "Raquel".
- O ganho de estruturar leads/estado/clientes fechados desde já compensa não ter que retrabalhar depois.
- A base de clientes fechados precisa de um processo de atualização (como novos fechamentos entram nela).
  Tratar quando a fase de fechamento de contrato for automatizada.
