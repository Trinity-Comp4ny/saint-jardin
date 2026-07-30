# ADR-0005 — Agendamento de visita de noiva pelo bot

**Status:** aceito
**Data:** 30/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md), [Agendamento de visita](../02-spec/agendamento-visita.md)

## Contexto

No MVP original (spec fase 1), "cliente quer agendar visita" era handoff seco: o bot silenciava e a
Raquel agendava tudo à mão. Feedback do Matheus: esse é o momento mais quente da conversa e vale o bot
conduzir o agendamento, consultando um calendário de visita e chegando a um horário concreto.

Distinção dos docs de descoberta ([material-whatsapp](../01-descoberta/material-whatsapp.md)):
- **Visita normal** = novos noivos. Sábado de manhã, ou seg-sex comercial. É a visita que a noiva do
  primeiro contato marca.
- **Visita técnica** = fornecedor de casamento já fechado. Segue fora do escopo (backlog).

O calendário de disponibilidade de **evento** (ADR-0002) é livre/ocupado por dia. Visita é outra coisa:
precisa de **horários (slots)**, não de dia inteiro. São contratos diferentes.

## Decisão

1. **Porta própria `AgendaVisita`** (slots de horário), separada do `Calendario` de evento. O núcleo
   fala com a porta; a fonte do calendário é detalhe do adapter.

2. **Adapter plugável, começando por `SupabaseAgendaVisita`.** A disponibilidade sai das *janelas de
   visita* configuráveis (regras de dia/hora) menos os horários já ocupados, persistidos na tabela
   `visitas`. Persistir é obrigatório: o runtime é serverless (Vercel), estado em memória não sobrevive
   entre invocações. Trocar depois por Google/Apple (export `.ics` ou API) é só um novo adapter no
   `deps.ts`, sem tocar no fluxo. É o "trocar o link" que o Matheus pediu.

3. **O bot marca de fato** (escreve na tabela `visitas`) quando a noiva confirma o horário, e avisa a
   Raquel. Difere do ADR-0002 (que adiou escrita): ali a escrita era no calendário sensível de evento;
   aqui é numa tabela dedicada de visita, sem dado financeiro nem pessoal da Raquel. O risco de LGPD que
   motivou o ADR-0002 não se aplica.

4. **Janelas de visita configuráveis, com default provisório** (sábado 9h-12h + seg-sex 9h-17h, blocos
   de 1h), marcado no código como `CONFIRMAR COM A RAQUEL`. Os horários reais saem dela antes do go-live.

5. **Fallback seguro:** sem `AgendaVisita` configurada, o aceite de visita volta ao handoff seco de
   antes. A feature liga/desliga por presença do adapter.

## Revisão 30/07/2026 — o bot NÃO marca; coleta e repassa

Feedback da Raquel depois de ver o fluxo automático: ela prefere **agendar as visitas ela mesma**
(com a mãe). Motivos: precisa olhar a agenda, negociar o dia com o cliente, e atende novos clientes
quase todo dia (inclusive domingo). Então o agendamento automático (marcar sozinho) foi revertido.

Novo comportamento:
- **Visita de noiva (novos clientes):** o bot pergunta a preferência de dia/horário e **repassa** para
  a Raquel (handoff com a preferência anexada). Quem marca é ela.
- **Visita técnica (fornecedor de casamento fechado):** regras da Raquel — **terça a sexta** e **mínimo
  30 dias de antecedência**. O bot valida a data pedida: se cumpre, responde "vou verificar a
  disponibilidade" e repassa; se não, explica a regra e pede outra data. Quem confirma é a Raquel.
- **Google Calendar:** não é usado neste momento (nem leitura). O adapter `GoogleAgendaVisita`, a porta
  `AgendaVisita` e o `SupabaseAgendaVisita` **ficam guardados no código** (desconectados do fluxo) para
  retomar quando/if a Raquel quiser automação de leitura ou escrita.

O restante deste ADR (porta plugável, calendário dedicado, separação de dado sensível) segue válido como
base para a retomada futura.

## Consequências

- Ganho direto: a noiva sai da conversa com um horário proposto e marcado, não no vácuo esperando a
  Raquel. Menos trabalho manual.
- A tabela `visitas` vira a fonte de verdade de ocupação enquanto não houver Google/Apple. Quando entrar
  o calendário real, decidir sincronização (espelhar vs ler direto) em ADR próprio.
- Marcação dupla / cancelamento / remarcação pela noiva não são tratados no MVP desta feature: qualquer
  ajuste após confirmar cai em handoff pra Raquel. Documentado na spec.
- O bot nunca oferece horário fora das janelas configuradas, então não invade a rotina de visita técnica
  (dia de semana) sem querer — desde que as janelas reflitam o que a Raquel realmente atende.
