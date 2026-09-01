# ADR-0009 — Rate limit por telefone (proteção contra custo de LLM)

**Status:** aceito
**Data:** 01/09/2026
**Relaciona:** [ADR-0004](./0004-arquitetura.md) (arquitetura, "LLM só lê"), [ADR-0007](./0007-transcricao-via-gemini.md)

## Contexto

O bot não tinha nenhuma proteção contra volume de mensagens por número. Cada mensagem que entra pelo
webhook e passa pela fila dispara pelo menos 1 chamada ao Gemini (NLU), podendo somar +1 (transcrição de
áudio) e +N (Redator, por pergunta humanizada). O webhook em si é protegido por assinatura HMAC (só a
Meta consegue postar), mas qualquer pessoa que mande mensagem pro número real de WhatsApp da Raquel é,
por natureza do produto, uma origem "confiável" o bastante pra entrar no pipeline — não há como a
assinatura HMAC filtrar abuso vindo de um número de telefone real conversando com o bot.

Sem limite, um número (por engano, script, ou má-fé) mandando muitas mensagens ou áudios seguidos gera
custo de LLM proporcional, sem trava nem alerta. Isso é risco de "denial of wallet", não de vazamento de
dado: a arquitetura já impede o LLM de decidir preço ou executar ação (ver ADR-0004), então o pior caso de
abuso aqui é custo indevido, não uma ação indevida do bot.

## Decisão

Rate limit simples por telefone, aplicado na ingestão (`ingerirWebhook`, antes de enfileirar), não no
processamento: barato de checar (uma contagem na própria tabela `fila_mensagens`) e barra o custo antes
dele existir, em vez de deixar a mensagem entrar na fila e só descartar depois de já ter sido processada.

- Novo método no port `Fila`: `contarRecentes(telefone, desdeISO)`, implementado via `count` do Postgrest
  filtrando por `telefone` e `criado_em >= desdeISO` na própria `fila_mensagens` (sem tabela nova).
- Índice `(telefone, criado_em)` adicionado (migration 0004) pra essa consulta não fazer full scan.
- Limite default: **30 mensagens por telefone a cada 60 minutos**, configurável via
  `RATE_LIMIT_MAX_MENSAGENS` / `RATE_LIMIT_JANELA_MINUTOS` (opcionais, com default no código — não exige
  configuração pra funcionar). 30/hora é bem folgado pra qualquer conversa real (a maior conversa de teste
  até agora teve menos de 15 mensagens no total), pensado pra travar só abuso de fato.
- Acima do limite: a mensagem é descartada silenciosamente (não enfileira, não responde, não conta como
  "vista" de novo — o `messageId` já foi marcado antes da checagem, então a Meta não fica reentregando em
  loop). Sem alerta pra Raquel nesta primeira versão.

## Consequências

- Protege contra o cenário de custo mais óbvio (spam de texto/áudio) sem tocar em `montarProcessDeps`
  nem exigir Telegram configurado no caminho de ingestão (que hoje só depende de Supabase, por design —
  ver comentário em `deps.ts`).
- Risco aceito conscientemente: se um número real bater o limite por engano (ex.: alguém digitando muito
  rápido, ou um teste mal calibrado), a mensagem é descartada SEM aviso pra ninguém — nem pro cliente, nem
  pra Raquel. Dado o limite folgado (30/hora), a chance de isso acontecer com uma noiva de verdade é baixa,
  mas não é zero. Se aparecer na prática, o próximo passo é alertar a Raquel (Telegram) na primeira vez que
  um número bate o limite, não a cada mensagem descartada.
- Não protege contra abuso distribuído (muitos números diferentes, poucas mensagens cada) — fora de
  escopo aqui; mitigação para esse caso seria no nível de conta da Meta/WhatsApp, não no código do bot.
