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
