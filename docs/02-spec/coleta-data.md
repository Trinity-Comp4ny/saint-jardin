# Spec: coleta da data do evento (fim do loop de data)

## Contexto

Teste real (31/07, conversa `5514998721100`): a noiva disse "sabado com 300
convidados", depois "outubro", depois "30", e o bot perguntou a data **5 vezes**
sem nunca avançar. Estado travou em `aguardando_qualificacao`; os 300 convidados
viraram 30 (o "30" do dia foi lido como convidados).

Três causas somadas:

1. **Pergunta de data era sim/não** ("Você já tem uma data em mente?"). A noiva
   responde "sim" e nada avança.
2. **Não havia como guardar mês sem dia.** "outubro" (mês sem dia) não cabe em
   `mesDia` (`MM-DD`), então era descartado a cada turno.
3. **Número solto virava convidados.** "30" (o dia) sobrescreveu os 300 convidados.

## Decisão

1. **Pergunta imperativa.** `perguntaData` pede dia, mês e ano de uma vez
   ("Qual a data? Me diz o dia, o mês e o ano, 2027 ou 2028"). Sem formato de
   sim/não.
2. **Slots `dia` e `mes`.** A NLU passa a extrair dia e mês soltos. A máquina de
   estados combina `mes` + `dia` de turnos diferentes em `mesDia` (em
   `mesclarSlots`). Todo o resto segue usando `mesDia` (nada muda downstream).
3. **Pergunta do dia quando só veio o mês.** Se há `mes` sem `dia`, o bot pergunta
   "Qual dia de outubro?" em vez de repetir a pergunta genérica.
4. **Desambiguação de número na NLU.** Um número solto logo após perguntarmos a
   data é o dia (`slots.dia`), não convidados. `convidados` só com contexto claro
   de pessoas ("150 convidados", "somos uns 200").

## Critérios de aceite

- "sábado, 300 convidados" → "outubro" → "30" leva a `mesDia = 10-30` e o bot
  pergunta só o ano (não repete a pergunta de data), sem estragar os 300.
- Mês sem dia ("outubro") → bot pergunta o dia daquele mês.
- Dia e mês juntos numa frase ("30 de outubro") continuam virando `mesDia` direto.
- A pergunta de data nunca é respondível com um "sim" que não avança.
