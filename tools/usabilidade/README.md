# Bateria de usabilidade

Conversas de noiva (89 cenários em `cenarios.ts`) para ver o que o bot responde de verdade:
primeiro contato, qualificação, mini wedding, depois da proposta, visita, borda.

Não é teste automatizado (não roda no CI): usa o Gemini real, que varia entre chamadas e custa
tokens. Serve para olhar as respostas depois de mudar prompt, regra ou texto.

## Local (sem WhatsApp, sem Telegram)

```bash
set -a; . ./.env; set +a
npm run usabilidade              # todos os cenários (~1 min)
npm run usabilidade -- C         # só os que começam com C
npm run usabilidade:ver          # lê o resultado como conversa
npm run usabilidade:ver -- local D03
```

Código real, Gemini real (NLU e Redator), repositórios em memória, calendário simulado com
`2027-10-09` ocupado. O resultado fica em `saida/` (ignorado pelo git).

## Produção (envia mensagens reais)

`prod.ts` posta no webhook assinado como se fosse a Meta, de um número de `NUMEROS_TESTE`. O
bot responde de verdade no WhatsApp desse número e cenários de handoff avisam o Telegram da
Raquel. Exige `CONFIRMO_PRODUCAO=sim`. Veja o cabeçalho do arquivo.

Cuidados: limpa a fila do número de teste a cada mensagem (o rate limit é 30 por hora); a
janela de 24h da Meta precisa estar aberta (o número precisa ter escrito para o bot nas últimas
24h), senão os envios falham; `seed` pula o vídeo de 15 MB.

## Para repetir um cenário várias vezes (variação do modelo)

```bash
for i in 1 2 3 4 5; do npm run usabilidade -- B10; npm run usabilidade:ver -- local B10; done
```
