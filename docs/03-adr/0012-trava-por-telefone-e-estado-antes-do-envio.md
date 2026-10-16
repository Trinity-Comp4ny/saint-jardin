# ADR-0012: Trava por telefone e estado salvo antes do envio

**Status:** aceito
**Data:** 16/10/2026
**Relaciona:** [ADR-0006](./0006-humanizacao-e-agrupamento.md), [ADR-0009](./0009-rate-limit-por-telefone.md), [ADR-0011](./0011-migrations-automaticas-no-merge.md)

## Contexto

Em 16/10/2026 a Raquel testou por áudio e o bot repetiu a saudação e o vídeo de apresentação, e esqueceu a
data que ela tinha dito. Pelo banco: a transcrição estava correta; dois dos três turnos de áudio nunca
chegaram ao `finally` do `processarFila` (`processado_em` igual ao horário de chegada, contra 0 de 77
textos), não salvaram a conversa e gravaram só parte do log. O turno seguinte leu o estado `novo`.

Dois defeitos de projeto tornaram isso possível:

- O estado da conversa só era salvo no fim do turno, depois do envio. O envio é lento (o vídeo tem pausa de
  10 s), então qualquer morte no meio descartava o estado.
- Nada impedia dois turnos do mesmo telefone ao mesmo tempo. Cada um lia o estado antes de o outro salvar.

A causa de a execução ter morrido não foi determinada (sem acesso aos logs da Vercel).

## Decisão

- O orquestrador salva a conversa **antes** de enviar as mensagens. Se o envio falhar, o turno vira handoff
  como antes, mas a próxima mensagem já enxerga o estado avançado.
- Trava por telefone (`TravaTurno`, tabela `turno_trava`, migration 0010): a chave primária decide quem
  assume o turno. Quem não consegue espera até 45 s; se estoura, devolve os itens à fila (`Fila.devolver`) e
  o próximo ciclo tenta. A trava expira em 65 s (acima do `maxDuration` de 60 s), então um turno morto não
  bloqueia o número para sempre.
- Se a própria trava falhar (tabela ausente durante o deploy, banco fora), o turno segue sem ela: perder a
  resposta de uma noiva é pior que o risco de sobreposição.
- Chamadas externas ganham timeout para um `fetch` pendurado não segurar o turno até a função ser morta:
  15 s na Graph API, e no Gemini 10 s (transcrição e Redator) e 10 s (NLU) por chamada.
- O Gemini tenta de novo em erro passageiro (408, 429, 500, 502, 503, 504 e timeout), 3 chamadas no total
  (`src/adapters/geminiClient.ts`). O retry do SDK é opt-in: sem ele, um 503 de um segundo virava handoff
  mudo (visto em teste local em 16/10/2026).

## Consequências

- Um turno por telefone por vez. O `#reset` enviado no meio de um turno espera esse turno acabar.
- Se o envio falha depois de salvar, o estado diz que a abertura saiu mesmo sem ter saído; o handoff avisa
  a Raquel.
- O follow-up (`processarFollowups`) não usa a trava. As condições dele já checam o estado salvo.
- Para investigar turno morto: `processado_em` colado em `criado_em` na `fila_mensagens`.
