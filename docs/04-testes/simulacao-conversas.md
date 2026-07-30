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

### 3. Repetição da pergunta ao mudar um dado — CORRIGIDO (parcial)
As perguntas repetíveis (dados faltantes, data, ano) agora têm variantes, escolhidas
por uma semente derivada da mensagem (`ctx.seed`, sem persistir nada). Respostas
diferentes da noiva geram frases diferentes. Limitação: com 3 variantes, duas
respostas seguidas ainda colidem em ~⅓ dos casos (ex.: mudar de dia duas vezes). Se
incomodar, aumentar o número de variantes ou usar um contador persistido.

### 4. "Orçamento + visita" e "só visita" — CORRIGIDO
`agendar_visita` deixou de ser handoff genérico. Agora:
- Mensagem com dados + visita ("valor pra 150 num sábado de 2027 e marcar visita")
  segue o fluxo normal e **envia a proposta** (o convite à visita fecha a mensagem).
- "Só quero conhecer o espaço" (sem dados) **apresenta e vai à preferência de visita**,
  em vez de pedir dados de orçamento.
Nenhum dos dois cai mais em handoff silencioso.

## Observações (não são bugs — decisão de produto)

- **Capacidade**: "5000 convidados" gera a proposta normal sem ressalva (o PDF cita até
  200). Se a Raquel quiser um limite, dá para transbordar acima de X convidados.
- **Idiomas**: inglês e espanhol são entendidos e respondidos em português. OK para o
  público, mas vale a Raquel saber.
- **Hostil / cancelar**: caem em `fora_do_script` → handoff (humano assume). Adequado.
- **Data passada / ano fora de 2027-2028**: não trava (o ano inválido é ignorado); o
  bot volta a pedir o ano. Não há aviso de "data no passado".

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
