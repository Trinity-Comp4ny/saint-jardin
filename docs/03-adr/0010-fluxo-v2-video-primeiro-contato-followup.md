# ADR-0010: Fluxo v2 (vídeo, filtro de primeiro contato e follow-up de 12h)

**Status:** aceito
**Data:** 14/10/2026
**Spec:** [fluxo-v2](../02-spec/fluxo-v2.md). **Relaciona:** [ADR-0008](./0008-primeiro-contato-usa-dados-ja-informados.md)

## Contexto

Em 14/10/2026 a Raquel passou o fluxo novo: vídeo no lugar do PDF de apresentação, propostas por
ano com valores por dia da semana, convite de visita só depois de 12h de silêncio, e um jeito de
tratar a primeira mensagem sem depender de uma lista dos 100+ clientes fechados e assessorias.

## Decisão

1. **Vídeo de apresentação** (`MensagemSaida` tipo `video`), enviado por link assinado do bucket
   `propostas`. MP4 H.264/AAC de até 16 MB (limite da Cloud API). Pausa de 10 s depois do vídeo
   para a mensagem seguinte não chegar antes dele.
2. **Primeira mensagem filtrada pela intenção.** Só pedido de orçamento inicia o fluxo comercial.
   Cumprimento puro recebe "Como posso ajudar?" (estado `aguardando_assunto`); dúvida ou assunto que
   não é orçamento vai para a Raquel sem vídeo. A NLU ganha a intenção `saudacao`. Errar para o lado de
   perguntar uma vez a mais custa pouco; mandar vídeo e pergunta de data a quem já fechou foi a
   reclamação de 31/07.
3. **Recusa do mini** pergunta se pode enviar as propostas tradicionais (estado
   `aguardando_aceite_tradicional`). Aceite marca `slots.tradicionalAceito` para o mini não voltar
   a ser oferecido nas re-qualificações.
4. **Follow-up de 12h** como job no cron de `/api/process`, não como timer em memória: a Vercel é
   serverless. O estado vive em `conversas` (`proposta_enviada_em`, `ultima_entrada_em`,
   `followup_enviado_em`). A reivindicação é um UPDATE condicional atômico (dois ciclos do cron não
   enviam duas vezes). Janela de 8h às 20h de Brasília. Teto de 23h30 desde a proposta, por causa
   da janela de 24h da Meta para texto livre.
5. **"Sim" solto só é aceite de visita depois do follow-up.** Sem o convite imediato na proposta,
   "ok, obrigada" logo após o PDF não pode virar pergunta de visita.

## Consequências

- O follow-up 2 (uma semana depois) **não entra**: passa das 24h, exige template aprovado na Meta
  (custo por envio) e ainda não há texto.
- Proposta enviada entre 8h e 8h30 pode perder o follow-up (as 12h caem fora da janela e o dia
  seguinte já passa do teto de 23h30). Aceito por ser uma fatia pequena.
- Um cumprimento seguido de pedido de orçamento leva um turno a mais até a abertura.
- A classificação `saudacao` depende do prompt do Gemini. O MockNLU dos testes não prova o
  comportamento do modelo real: validar no número de teste com a Raquel.

## Ajustes de 15/10/2026 (primeiro teste no WhatsApp)

O primeiro teste real mostrou quatro pontos, corrigidos em seguida:

- **Dois cumprimentos seguidos.** O "como posso ajudar" e a abertura da Raquel começavam com "Olá, tudo
  bem?". Depois do "como posso ajudar", a abertura vai sem a saudação (`MSG.aberturaSemSaudacao`).
- **Resposta ao "oi" seca.** Passou a usar o trecho institucional que a Raquel já usava: "Olá, tudo bem? O
  Saint Jardin Eventos agradece seu contato. Como posso ajudar?".
- **"Legal! Só preciso saber..." fora do tom.** Era uma variante fixa de `pedirDadosFaltantes`, não o LLM.
  As variantes perderam as interjeições.
- **Redator (LLM) restrito.** Só é chamado se a mensagem da pessoa tem conversa social (`temConversaSocial`),
  e a resposta dele só vale se passar em `respostaDoRedatorAceitavel` (sem interjeição, gíria nem número que
  o objetivo não tinha). Senão vai o texto fixo. Regras determinísticas, em `src/domain/verniz.ts`: não
  dependem de o modelo obedecer ao prompt.
- **`#reset` arquiva o histórico** (migration 0007, coluna `mensagens.arquivada`) em vez de apagar, para
  conversas de teste poderem ser analisadas depois. Sem a migration, o código cai no comportamento antigo.

## Ajustes de 15/10/2026 (bateria de usabilidade, 89 cenários)

Uma bateria com o Gemini real (local) e 35 cenários em produção (webhook assinado, número de teste)
achou os pontos abaixo. Ferramenta guardada em `tools/usabilidade/` (não roda no CI: o modelo varia).

- **Convite de visita depois de toda proposta** (texto da Raquel, 15/10): "O que acharam da proposta?
  Gostaria de agendar uma visita...". Sai depois do PDF normal, do mini e do mini com informações. Com
  o convite imediato, "sim/ok" volta a valer como aceite na hora (a trava "só depois do follow-up"
  saiu). O follow-up de 12h continua.
- **Mini wedding nunca em feriado nem véspera** (`src/domain/feriados.ts`). Calculado no código, sem
  API: fixos, Páscoa (Meeus/Jones/Butcher) e os móveis (Carnaval seg e ter, Sexta Santa, Corpus
  Christi), qualquer ano. Os testes comparam com a BrasilAPI de 2026 a 2035. Feriados locais:
  `FERIADOS_LOCAIS` (vazio até a Raquel informar a cidade). Data de feriado vai para a proposta normal
  (o PDF tem o valor "sábado/feriado/véspera"). Só "durante a semana", sem data, ainda oferece o mini,
  cujo texto já diz "exceto feriados ou vésperas".
- **Visita fora do horário anunciado** (domingo, sábado depois das 13h, fora de 8h às 18h): em vez de
  recusar, o bot diz que vai ver com a equipe se abre uma exceção e passa para a Raquel, com o motivo
  "visita FORA DO HORÁRIO". "Horário comercial" assumido como 8h às 18h (a Raquel não definiu).
- **`#reset` passa em handoff.** O pipeline descartava a mensagem antes do comando de reset, justo
  quando o teste fica preso.
- **Entidades HTML** que o Gemini às vezes devolve ("s&#225;bado") são decodificadas.
- **Cliente fechada com data na mensagem** não recebe mais vídeo: no primeiro contato, dúvida ou
  negociação só ganha "vou verificar". O vídeo é só para quem pede orçamento.
- **Redes determinísticas sobre o NLU** (`intencoesDeterministicas.ts`, `slotsDeterministicos.ts`): evento
  que não é casamento, pergunta de preço (é pedido de orçamento), problema com o PDF ("não consegui
  abrir"), "vou ver com meu noivo" (indecisa: recebe o PDF do mini), "visita técnica", ano que o bot
  não vende com dados de orçamento, e "uns 40" como convidados. O modelo varia entre chamadas mesmo em
  temperatura 0, então regra que importa não depende dele.
- **Redator** só pergunta "e com você?" se a pessoa perguntou "tudo bem?".
- **Re-cotação só quando o dado muda**: o modelo às vezes reemite os dados já coletados.
- Pergunta fora do roteiro logo depois da oferta do mini recebe o PDF do mini e passa para a Raquel.

Decidido: handoff continua silencioso (sem aviso à noiva), inclusive para perguntas depois da proposta.

Em aberto, aguardando a Raquel: o que responder para 2026 e 2029 em diante, e o que fazer acima de 240
convidados (hoje manda a proposta).
