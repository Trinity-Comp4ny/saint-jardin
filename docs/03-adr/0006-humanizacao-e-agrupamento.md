# ADR-0006 — Redação humanizada e agrupamento de mensagens

**Status:** aceito
**Data:** 30/07/2026
**Relaciona:** [ADR-0004](./0004-arquitetura.md) (máquina de estados + LLM só lê)

## Contexto

No desenho original (ADR-0004), o LLM só **lê** (classifica/extrai) e a máquina de estados envia **textos
fixos**. Isso protege o mais crítico (o bot nunca inventa preço), mas gera duas queixas reais nos testes:

1. O bot **ignora small talk**: "tudo bem?" → resposta seca pedindo dados.
2. O bot **responde cada mensagem isolada**: uma rajada ("Boa tarde" + "tudo bem?" + "vou passar") vira três
   respostas, robótico.

## Decisão

Duas camadas novas, sem abrir mão da segurança de preço.

### 1. Redação humanizada (LLM escreve, mas só as perguntas)

Cada `MensagemSaida` conversacional (perguntas, convites) é marcada com `humanizar: true` na máquina de
estados. Antes de enviar, o orchestrator passa essas — e **só essas** — por um `Redator` (Gemini) que
reescreve na voz da Raquel, respondendo saudação/small talk e mantendo o pedido.

Blindagem: mensagens com **preço, proposta, orçamento mini ou regra** (apresentação, orçamentos, oferta
mini, limite, indisponibilidade, fora-de-regra) **nunca** recebem `humanizar` — vão literais. Como o Redator
só recebe textos-objetivo sem valores, não há o que ele inventar. O prompt ainda proíbe explicitamente citar
valores, datas ou condições. Falha do Redator cai no texto fixo (best-effort).

A máquina de estados continua sendo o cérebro: decide a ação, o PDF, o handoff e as regras. O LLM não decide
nada de negócio; só escolhe as palavras das perguntas.

### 2. Agrupamento de mensagens em rajada

`processarFila` agrupa as mensagens vencidas do **mesmo telefone** num único turno (textos concatenados por
ordem de chegada) e responde uma vez. A fila com delay (ADR-0001) já funciona como debounce natural:
mensagens próximas vencem juntas e são agrupadas.

Limitação: o agrupamento depende do delay. Em `MODO_TESTE` (resposta imediata no webhook), cada mensagem é
processada na hora e não agrupa — o agrupamento é comportamento de produção.

### Também

Ajuste no prompt da NLU: expressões de espera/social ("só um minuto", "já te passo", "obrigada") são
`seguir_fluxo`, não `fora_do_script` — evita handoff desnecessário por small talk.

## Consequências

- Respostas mais humanas sem risco de inventar preço (o valor nunca passa pelo Redator).
- +1 chamada LLM por pergunta (flash-lite, barato). A NLU e o Redator são chamadas separadas.
- Custo de latência do agrupamento já estava embutido no delay proposital.
- A variabilidade do LLM (classificação/redação) é inerente; a lógica de negócio fica coberta por testes
  unitários determinísticos (a máquina de estados é pura).
