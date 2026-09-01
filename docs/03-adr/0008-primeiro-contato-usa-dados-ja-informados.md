# ADR-0008 — Primeiro contato usa os dados que a noiva já deu

**Status:** aceito
**Data:** 01/09/2026
**Relaciona:** [ADR-0006](./0006-humanizacao-e-agrupamento.md) (agrupamento de mensagens), [ADR-0007](./0007-transcricao-via-gemini.md) (transcrição de áudio)

## Contexto

No primeiro contato (`case 'novo'`), o bot sempre mandava a saudação + PDF de apresentação + a pergunta
qualificadora LITERAL (data/ano, dia da semana e nº de convidados), **mesmo quando a mensagem já trazia
essa informação**. Os dados extraídos ficavam guardados nos slots e só eram usados a partir da resposta
seguinte.

Isso passou de detalhe menor a problema real com a transcrição de áudio (ADR-0007): quem manda um áudio
tende a falar tudo de uma vez ("...seria em 2028, num sábado, para 240 pessoas"), e ver o bot perguntar de
novo o que ela acabou de dizer quebra a fluidez da conversa de um jeito que praticamente não acontecia
por texto (mensagens de texto tendem a ser mais curtas, um dado por vez).

## Decisão

Extraída a lógica de "o que falta e o que fazer com isso" do `case 'aguardando_qualificacao'` para uma
função `qualificar(base, slots, nlu, ctx)`, reaproveitada em dois lugares:

- `case 'aguardando_qualificacao'`: comportamento idêntico a antes (só chama a função).
- `case 'novo'`, quando a mensagem já trouxe QUALQUER dado de orçamento (`jaVeioAlgumDado`): chama a mesma
  função em vez da pergunta qualificadora fixa. Resultado:
  - **Nada faltando** (dia + convidados já vieram): pula direto pra oferta de mini wedding ou pra
    proposta (`avancarComData` cuida do ano/data que ainda faltar), tudo no mesmo turno.
  - **Falta algo**: pergunta só o que falta (`pedirDadosFaltantes`), não a pergunta genérica inteira.
  - **Nenhum dado veio**: comportamento inalterado, pergunta qualificadora literal completa.

Importante: essa chamada é direta à função `qualificar`, não uma recursão em `decidir` com o estado
trocado — evitaria reabrir os checks de handoff do topo de `decidir` (`negociar`/`fora_do_script`
transbordam em qualquer estado != `'novo'`), que não devem valer ainda no primeiro turno.

## Consequências

- Conversa mais fluida quando a pessoa já adianta tudo (comum em áudio, mas vale pra texto também).
- Sem duplicação de lógica entre `'novo'` e `'aguardando_qualificacao'`: uma função só decide o próximo
  passo da qualificação.
- A pergunta qualificadora literal (texto de marca, não humanizado) só aparece quando NADA foi
  adiantado — ela deixa de ser garantida em todo primeiro contato.
- Ainda intocado: a lógica de disponibilidade de calendário, mini wedding e o resto do fluxo depois da
  qualificação (`avancarComData`, `ehMiniWedding`) não mudou.
