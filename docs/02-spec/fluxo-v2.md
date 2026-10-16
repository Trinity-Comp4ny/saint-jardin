# Spec: fluxo v2 do atendimento (14/10/2026)

Status: **implementado**, exceto o follow-up 2 (uma semana depois), que fica para depois (precisa de texto e de template na Meta). Ver [ADR-0010](../03-adr/0010-fluxo-v2-video-primeiro-contato-followup.md).
Fontes: [material-2026-10-14](../01-descoberta/material-2026-10-14.md) (textos literais e PDFs),
[perguntas-raquel-2026-10-14](./perguntas-raquel-2026-10-14.md) (perguntas e padrões adotados).
Os textos da Raquel são literais: não reescrever, não humanizar.

## 1. Decisões

| # | Decisão | Origem |
|---|---|---|
| D1 | Apresentação em vídeo substitui o PDF de 37 páginas | Raquel, 14/10 |
| D2 | Convite de visita sai da proposta e vai só no follow-up | Matheus, 14/10 |
| D3 | "Não" ao mini: perguntar "podemos então enviar nossas propostas tradicionais que incluem o final de semana também?". Se sim, PDF do ano pedido | Raquel, 14/10 18:03 |
| D4 | Pergunta sobre o mini (em vez de sim ou não): "Segue nosso PDF de mini wedding com as informações:" + PDF | Raquel, 14/10 18:04 |
| D5 | R$58.000 na Proposta II seg a qui de 2028 está certo | Raquel, 14/10 18:05 |
| D6 | Follow-up 1 após 12h, follow-up 2 depois de uma semana, janela das 8h às 20h | Raquel, 14/10 18:05 |
| D7 | Depois de aceitar o mini, o anúncio curto atual antes do PDF | Matheus, 14/10 |
| D8 | Primeira mensagem: ver seção 2 (a confirmar) | Raquel, 14/10 18:05 |

## 2. Primeira mensagem (estado `novo`), a confirmar

Problema: a Raquel não consegue listar os 100+ clientes fechados e assessorias. Sem lista, o bot não
pode contar com o cadastro de contatos para evitar vídeo e pergunta de orçamento para quem já fechou.
Regra: só inicia o fluxo comercial quando a mensagem pede orçamento.

| A mensagem é | O bot faz |
|---|---|
| Pedido de orçamento, valores, datas, ou "quero conhecer o espaço" (inclui o texto pronto do Instagram) | Fluxo completo: msg 1, vídeo, pergunta qualificadora |
| Só cumprimento ("oi", "bom dia", "tudo bem?") | "Olá, tudo bem? Como posso ajudar?" e espera. Estado novo `aguardando_assunto` |
| Pergunta ou assunto que não é orçamento (cliente fechado, assessoria, dúvida) | "Sobre o que você perguntou, vou verificar direitinho e já te respondo, ok?" e passa para a Raquel. Sem vídeo |
| Fornecedor | Igual a hoje ("Entendi! Já te atendo direitinho...") e passa para a Raquel |
| Cliente fechado identificado por número ou nome | Silêncio e passa para a Raquel (igual a hoje) |

Em `aguardando_assunto`: se a próxima mensagem pede orçamento, fluxo completo; qualquer outra coisa
passa para a Raquel com a mesma resposta da linha de dúvida.

## 3. Fluxo comercial

```
novo ─ pede orçamento ─► msg1 + vídeo ─► aguardando_qualificacao
                              (dados já vieram? pula a pergunta e segue, ADR-0008)

aguardando_qualificacao ─ dia + convidados ─┬─ mini (seg a qui, até 80) ─► aguardando_interesse_mini
                                            └─ resto ─► [ano? data? disponibilidade] ─► proposta normal

aguardando_interesse_mini
   sim ......................... "Certo, segue PDF com o orçamento do mini wedding:" + PDF mini ─► proposta_enviada
   dado novo (fim de semana...)  re-qualifica
   não ......................... "podemos então enviar nossas propostas tradicionais...?" ─► aguardando_aceite_tradicional
   qualquer outra resposta ..... "Segue nosso PDF de mini wedding com as informações:" + PDF mini ─► proposta_enviada

aguardando_aceite_tradicional
   sim ......................... [ano? data? disponibilidade] ─► proposta normal
   não ......................... encerra (despedida cordial)
   dado novo ................... re-qualifica

proposta normal = msg de ano ("Vou te enviar nossa proposta para casamentos em {ano}...") + PDF do ano ─► proposta_enviada
```

`aguardando_aceite_tradicional` precisa lembrar o ano: se o ano não foi dito, o "sim" cai na pergunta
de ano que já existe (`avancarComData`).

## 4. Depois da proposta (`proposta_enviada`)

- O bot manda o convite de visita logo depois do PDF (texto da Raquel de 15/10/2026, ver ADR-0010).
- "sim" ou "ok" depois da proposta aceita o convite de visita, que vem junto do PDF (a trava "só depois do
  follow-up" saiu em 15/10/2026).
- "ok", "obrigada": silêncio.
- Pedido de visita ou "sim" depois do follow-up: "Realizamos visitas de segunda a sexta-feira, em
  horário comercial, e aos sábados, das 8h às 13h. Que dia ficará melhor para vocês?" (literal, não
  humanizada). Substitui `perguntaPreferenciaVisita` em todos os pontos.
- Dia e horário dados: igual a hoje ("anotei, vou confirmar", passa para a Raquel).

### Follow-ups

| | Quando | Texto | Canal |
|---|---|---|---|
| 1 | 12h após o envio da proposta, sem nenhuma mensagem da pessoa depois | Mensagem 1.7 do material (convite de visita) | Texto livre (dentro das 24h da Meta) |
| 2 | 1 semana depois | Texto ainda não definido | **Template aprovado na Meta**, porque passa de 24h. **Fora de escopo** por decisão de 16/10: ficam só os de 12h |
| Convite | 5 a 30 min depois do PDF da proposta, sem nenhuma mensagem da pessoa, das 8h às 20h | Mensagem 1.7 ("O que acharam da proposta?...") | Texto livre. Pedido da Raquel, 16/10. Antes saía junto do PDF |
| Retomada | 12h depois da última mensagem da pessoa, em `aguardando_qualificacao` (parou antes de passar data ou convidados) | "Oi, gostaria de retomar o orçamento?" (proposta do Matheus, 16/10, a confirmar com a Raquel) | Texto livre (dentro das 24h da Meta) |

O convite usa a coluna `convite_enviado_em` (migration `0011`; nulo depois de uma proposta = pendente). Se a
pessoa responder antes dos 5 minutos sem pedir nada ("adorei!"), o convite sai logo depois da resposta do bot,
uma vez só. Depois de 30 minutos ele não sai mais (cron parado, ou proposta à noite): quem cobre é o follow-up
de 12h, que já traz o convite, e depois dele uma resposta solta também não repete o convite.

A retomada usa as mesmas regras de tempo do follow-up 1 (12h a 23h30, 8h às 20h), contadas da última
mensagem da pessoa, e reaproveita a coluna `followup_enviado_em` (a proposta a zera ao sair, então o
follow-up 1 segue valendo depois). Resposta "sim" continua pedindo o que falta; "não" ou "depois eu volto"
encerra com cordialidade. Não vale para quem só cumprimentou (`aguardando_assunto`), nem para a oferta do mini.

Regras comuns: só em `proposta_enviada`; nunca em `handoff`, `humano` ou `encerrada`; só das 8h às 20h
(Brasília). Se o horário cair fora da janela, espera abrir. Cada follow-up sai uma vez. Se a pessoa
responder qualquer coisa, os pendentes são cancelados e a conversa segue o fluxo normal.

Dados: migration `0006` em `conversas`: `proposta_enviada_em`, `followup1_enviado_em`,
`followup2_enviado_em`, e a data da última mensagem da pessoa (ou lida do log). Execução: passo novo no
cron de `/api/process` (a cada 15 min).

## 5. Mudanças técnicas

- `types.ts`: `MensagemSaida` ganha `tipo: 'video'`; `TipoMensagemLog` ganha `'video'`; estados novos
  `aguardando_assunto` e `aguardando_aceite_tradicional` (o CHECK de estado já foi removido do banco,
  a fonte da verdade é o tipo TS); `Intencao` ganha `saudacao`.
- `pdfs.ts`: remove `apresentacao`; catálogo de vídeo (`apresentacao-saint-jardin.mp4`).
- `persona.ts`: textos novos (msg 1, msg de ano 2027/2028, Como posso ajudar, aceite tradicional,
  PDF mini com informações, visita, follow-ups). Saem `orcamentoNormalDescricao`, `conviteVisita` do
  fluxo da proposta e `MSG.apresentacao(nome)`.
- `stateMachine.ts`: casos `novo`, `aguardando_interesse_mini`, `proposta_enviada`, e os 2 estados novos.
- `WhatsAppCloudProvider.ts`: envio de `video` (link) com pausa maior depois do vídeo; envio de template.
- `GeminiNLU.ts` e `MockNLU.ts`: intenção `saudacao`; histórico mostra "[enviou um vídeo]".
- Testes: 6 asserts de `'apresentacao'` mudam; casos novos para cada seta do fluxo acima, follow-up
  (janela, 24h, cancelamento por resposta) e "ok" logo após a proposta ficar em silêncio.

## 6. Arquivos a publicar (bucket `propostas`)

Prontos em `.context/out/` (comprimidos, conferidos contra o original):
`Proposta Saint Jardin 2027.pdf` (6,6 MB), `Proposta Saint Jardin 2028.pdf` (6,6 MB),
`Proposta Mini Wedding.pdf` (5,4 MB), `apresentacao-saint-jardin.mp4` (14,7 MB, H.264/AAC, 720x1280).
O vídeo precisa ficar abaixo de 16 MB (limite da Cloud API).

## 7. Perguntas abertas

1. O follow-up 2 conta uma semana depois do follow-up 1 ou da proposta? Qual o texto?
2. Template na Meta para o follow-up 2: criar e aprovar (categoria provável: marketing, com custo por
   envio). Ou aceitamos só o follow-up 1 por enquanto?
3. Silêncio depois da oferta do mini (sem proposta enviada): sem follow-up até haver texto para isso.
