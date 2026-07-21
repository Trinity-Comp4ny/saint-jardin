# ADR-0002 — Calendário dedicado para disponibilidade

**Status:** proposto
**Data:** 21/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md)

## Contexto

A IA precisa checar se uma data de evento está disponível e sugerir alternativas. A Raquel se ofereceu
para dar acesso ao seu Google Agenda.

Problema: o Google Agenda dela ([print e descrição](../01-descoberta/material-whatsapp.md#5-calendário-google-agenda))
mistura, na mesma conta:
- Eventos (casamentos) — 🔴 vermelho
- Pagamentos de clientes, com valores — 🟠 laranja / 🟢 verde
- Compromissos **pessoais** (consultas "Dr. Márcio") — 🔵 azul

Dar à IA acesso a essa conta exporia dados pessoais da Raquel e dados sensíveis de clientes (valores,
contratos), sem necessidade: para checar disponibilidade, basta saber quais **datas estão ocupadas por
evento**.

## Decisão

Criar um **calendário dedicado só para disponibilidade de datas de evento**, contendo apenas informação
de livre/ocupado (sem valores, sem nomes sensíveis, sem dados pessoais). A IA tem acesso **somente** a
esse calendário.

Opções de implementação (a decidir na build):
- Um calendário Google separado dentro da conta, compartilhado com a IA em modo leitura de
  disponibilidade; **ou**
- Uma cópia/sincronização automática que espelha só as datas de evento do calendário principal para o
  dedicado.

No MVP, o Matheus prototipa com o **próprio calendário de teste** antes de conectar qualquer dado real
(como combinado na call).

## Consequências

- A IA nunca lê a agenda pessoal da Raquel nem valores de clientes. Reduz risco de LGPD e vazamento.
- A Raquel precisa manter as datas de evento nesse calendário dedicado atualizadas (ou a sincronização
  precisa ser confiável). Overhead operacional a validar.
- Quando a fase futura (lançar evento/pagamento automaticamente) chegar, o desenho de escrita será
  tratado em ADR próprio, mantendo a separação entre disponibilidade (pouco sensível) e financeiro
  (sensível).
- A automação de cor de pagamento (laranja→verde) fica fora deste ADR e do MVP: depende de conciliação
  bancária ou recibo, conforme a própria Raquel apontou (áudio 4).
