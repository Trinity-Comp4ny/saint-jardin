# Simulação de conversas — achados

Bateria de 46 cenários rodada pelo **NLU real (Gemini)** + orchestrator + máquina de
estados, 100% em memória. Roda com:

```
npx tsx src/sandbox/simular.ts
```

O harness (`src/sandbox/simular.ts`) usa um NLU espião (registra o que o modelo
entendeu) e detecta anomalias automáticas: silêncio inesperado, repetição de texto,
estado final diferente do esperado e motivo de handoff. Cobre: saudações,
qualificação (completa e em partes), data (dia/mês, completa, ano de 2 dígitos, "dia
5 do 12 de 2027"), mini wedding vs normal (limite 80 exato), negociação, visita de
noiva, visita técnica (regras), cliente fechado, fora do script, linguagem informal
(typos, áudio transcrito, emojis) e mensagens ambíguas.

## Achados

### 1. NLU travava com ano fora de 2027/2028 — CORRIGIDO (crítico)
O Gemini às vezes devolvia `ano` fora do par 2027/2028 e o Zod **lançava**
(`ZodError`), derrubando `analisar()` inteiro. Em produção, isso **travaria a
conversa** (a mensagem não seria processada). Corrigido em `GeminiNLU.ts`: `ano` e
`convidados` ganham `.catch(undefined)`, e o parse final usa `safeParse` com
degradação segura para `seguir_fluxo`. Nenhum retorno do modelo derruba mais o fluxo.

### 2. Loop no `aguardando_confirmacao_normal` — CORRIGIDO
Dia de semana com >80: a noiva confirmava ("sim, pode mandar"), mas se ainda faltava
o ano, o bot perguntava a data **sem trocar de estado**. A resposta seguinte (o ano)
não era "afirmativo", então o bot **repetia a explicação do limite** em loop.
Corrigido com o estado `aguardando_data_normal`: depois do "sim", o fluxo só coleta
data/ano e envia a proposta, sem re-explicar.

### 3. Repetição da pergunta ao mudar um dado — PENDENTE (UX)
Quando a noiva corrige um dado ("sábado 200" → "ah não, melhor domingo"), o bot
repete a **mesma** pergunta de data, palavra por palavra. Não quebra o fluxo (chega à
proposta), mas soa robótico. Melhoria: variar a frase / reconhecer a correção.

### 4. "Orçamento + visita" na 1ª mensagem → handoff silencioso — PENDENTE (UX/produto)
Mensagem como "quero o valor pra 150 num sábado de 2027 e já marcar uma visita" cai
direto em handoff (intenção `agendar_visita`), **sem apresentar o espaço, sem a
proposta e sem nenhuma resposta à noiva** — só a Raquel é avisada. Opção: mandar a
apresentação/proposta primeiro (ela deu todos os dados) e/ou uma mensagem-ponte antes
de transbordar. Ligado ao tema do "handoff silencioso".

## O que está sólido (passou sem ressalva)

- Extração de slots do Gemini: dia, convidados, ano (inclusive "28" → 2028 e "ano que
  vem"), data completa, `mesDia` sem ano, "dia 5 do 12 de 2027".
- Mini wedding vs normal, com o limite de 80 exato (80 = mini, 81 = normal) e correção
  de convidados no meio (200 → 60 volta para mini).
- Visita técnica: sem data (pergunta a regra), data válida (repassa), fim de semana e
  antecedência < 30 dias (orienta), correção para data válida (repassa).
- Negociação, desconto, parcelamento → handoff. Fora do script (buffet, pet,
  estacionamento, endereço) → handoff. Cliente fechado → handoff.
- Linguagem informal: typos/abreviações, áudio transcrito longo, emojis, respostas
  muito curtas em sequência.
