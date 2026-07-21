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

1. **Tabela de preços como fonte única de verdade** — não deduzir preço de PDF. Estrutura mínima:
   `ano × dia_da_semana × faixa_de_convidados × pacote → { valor_total, entrada, parcelas, pdf }`.
   Os PDFs viram artefato de envio, não fonte de cálculo.
2. **Base de leads/conversas** — cada lead com número, estado da conversa, data pretendida, nº de
   convidados, origem (Instagram/direto), timestamps. Habilita follow-up e, depois, o CRM da plataforma.
3. **Base de clientes fechados** — lista de números que a IA não deve atender (regra crítica da spec).
4. **Persona única** — um nome só para a atendente virtual, fixado em config, reaproveitável.

## Consequências

- O MVP fica pronto para migrar para a plataforma sem reescrever a lógica de preço nem perder histórico
  de leads.
- Exige, antes de codar, **fechar a tabela de preços completa** (falta 2028 e confirmar domingo/sexta e
  mini wedding) — vira decisão pendente na spec.
- Exige a Raquel escolher **um nome** para a persona.
- Custo inicial um pouco maior que "só um prompt com os textos", compensado por não retrabalhar depois.
- A base de clientes fechados precisa de um processo de atualização (como novos fechamentos entram nela).
  Tratar quando a fase de fechamento de contrato for automatizada.
