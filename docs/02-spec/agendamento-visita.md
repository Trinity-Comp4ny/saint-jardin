# Spec — Visitas (noiva e técnica)

**Status:** em implementação
**Depende de:** [ADR-0005](../03-adr/0005-agendamento-visita.md) (ver Revisão 30/07), [MVP Fase 1](./mvp-fase-1.md)

## Objetivo

O bot **não marca** visitas: ele coleta o que precisa e **repassa para a Raquel** agendar. Dois casos.

## 1. Visita de noiva (novos clientes)

Entra pelo aceite do convite à visita (estado `proposta_enviada` + resposta afirmativa).

1. Bot pergunta a preferência: "Que ótimo! Tem algum dia/horário melhor pra você? Assim já confirmo com a
   equipe." → estado `aguardando_pref_visita`.
2. A noiva responde (qualquer coisa) → bot diz "Perfeito! Já verifico e te retorno" e **repassa para a
   Raquel** (handoff), anexando a preferência ao motivo. Quem marca é a Raquel.

Não há regra de dia/horário: novos clientes são atendidos quase todo dia (inclusive domingo).

## 2. Visita técnica (fornecedor de casamento já fechado)

Entra quando a NLU classifica a intenção como `visita_tecnica` (o contato pede visita técnica), em
qualquer estado.

**Regras da Raquel:** só **terça a sexta**, com **pelo menos 30 dias de antecedência**.

1. Sem data ainda → bot pergunta a data já informando a regra: "Nossas visitas técnicas são de terça a
   sexta, com pelo menos 30 dias de antecedência. Para qual data seria?" → estado `visita_tecnica_data`.
2. Com data:
   - **Cumpre as regras** (terça-sexta E ≥ 30 dias) → "Perfeito, vou verificar a disponibilidade e te
     retorno" e **repassa para a Raquel** (handoff com a data). Quem confirma é a Raquel.
   - **Fora da regra** → explica o motivo (fim de semana, ou antecedência insuficiente) e pede outra data,
     seguindo em `visita_tecnica_data`.

Data só com dia/mês (sem ano): assume o próximo ano em que a data cai a ≥ 30 dias à frente.

## Fora deste escopo (guardado)

Agendamento automático pelo bot (marcar sozinho) e integração ativa com o Google Calendar. O adapter
`GoogleAgendaVisita`, a porta `AgendaVisita` e o `SupabaseAgendaVisita` ficam no código, desconectados do
fluxo, para retomada futura.

## Critérios de aceite

- [ ] Aceite da visita de noiva pergunta a preferência e, na resposta, repassa para a Raquel com a
      preferência no motivo do handoff.
- [ ] Visita técnica em fim de semana ou com < 30 dias → bot explica a regra e pede outra data.
- [ ] Visita técnica terça-sexta e ≥ 30 dias → "vou verificar a disponibilidade" + handoff com a data.
- [ ] Data técnica só com dia/mês resolve o ano para a próxima ocorrência a ≥ 30 dias.
- [ ] Máquina de estados coberta por teste.
