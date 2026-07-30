# Spec — Agendamento de visita de noiva

**Status:** em implementação
**Depende de:** [ADR-0005](../03-adr/0005-agendamento-visita.md), [MVP Fase 1](./mvp-fase-1.md)

## Objetivo

Depois de enviar a proposta e convidar para conhecer o espaço, o bot conduz o agendamento da **visita
normal** (novos noivos) até um horário concreto, marca na agenda e avisa a Raquel. Substitui o handoff
seco de "quer agendar visita".

## Fluxo

Entra pelo aceite do convite à visita (estado `proposta_enviada` + resposta afirmativa).

1. **Pergunta a preferência.** "Que ótimo! 😊 Você prefere algum dia pra conhecer o espaço? Pode ser
   essa semana ou a próxima." → estado `agendando_visita`.
2. **A noiva responde.** O NLU extrai a preferência de visita (dia da semana e/ou período manhã/tarde),
   ou detecta indiferença ("tanto faz", "qualquer dia").
3. **O bot oferece um horário concreto** dentro das janelas de visita:
   - Com preferência → primeiro slot livre que casa; se nenhum casa, o mais próximo livre.
   - Indiferente → o próximo slot livre.
   - "Consigo quinta (07/08) às 14h. Fica bom pra você?" → estado `aguardando_confirmacao_visita`,
     guardando o slot proposto na conversa.
4. **A noiva confirma** → o bot **marca** o slot na agenda, confirma ("Marcado! Te espero quinta às 14h
   😊") e **avisa a Raquel** (aviso, não handoff de silêncio). Estado `visita_agendada`.
   - Se ela pede outro dia/horário (nova preferência) → volta ao passo 3 com a nova preferência.
   - Se recusa sem alternativa → handoff pra Raquel resolver.
5. **Sem vaga** em nenhuma janela do horizonte → handoff pra Raquel agendar manualmente.

## Regras

- **Janelas de visita** (dias/horas ofertáveis) são configuração, com default provisório
  `CONFIRMAR COM A RAQUEL`: sábado 9h-12h e seg-sex 9h-17h, blocos de 1h.
- **Horizonte**: oferece dentro das próximas ~2 semanas.
- **Fonte de ocupação**: tabela `visitas` (adapter Supabase). Trocável por Google/Apple depois (ADR-0005).
- **Bot marca de fato** ao confirmar (escreve em `visitas`). Remarcar/cancelar depois = handoff.
- **Fallback**: sem agenda configurada, aceite de visita = handoff seco (comportamento anterior).

## Critérios de aceite

- [ ] Aceite da visita pergunta a preferência (não transborda cego).
- [ ] Preferência de dia/período leva a um slot que casa; sem casar, o mais próximo.
- [ ] "Tanto faz" leva ao próximo slot livre.
- [ ] Confirmar marca na tabela `visitas`, avisa a Raquel e fecha em `visita_agendada`.
- [ ] Slot já ocupado não é oferecido duas vezes.
- [ ] Sem vaga no horizonte → handoff.
- [ ] Máquina de estados coberta por teste (com agenda fake determinística).
