# Spec: perguntas frequentes (hospedagem, pacotes) e valores

Origem: pedidos da Raquel de 16/10/2026 ([material](../01-descoberta/material-2026-10-16.md)). Teste real:
"E a tabela de valores? Vocês têm hospedagens?" caiu em handoff mudo.

## Comportamento

- Hospedagem e pacotes têm texto fixo da Raquel (nunca humanizado). O bot responde e deixa o fluxo seguir.
- Detecção por regra (`duvidasNoTexto`), não pelo modelo: o modelo classificava como `fora_do_script`.
  A intenção volta a `seguir_fluxo`, exceto na oferta do mini (mantém PDF do mini e repasse) e em evento
  que não é casamento.
- "pacote 3" é pacote da proposta (vai para a Raquel). Só valem sinais explícitos: "pacote(s) fechado(s)",
  "tem/trabalham com pacote", "tudo incluso", "buffet/decoração incluso".

| Estado | O que o bot faz |
|---|---|
| Primeiro contato / qualificação | abertura e vídeo (se for o caso), resposta da dúvida, depois a pergunta do fluxo |
| Combinando a visita, só dúvida | responde e continua esperando o dia |
| Combinando a visita, com pergunta de valor | responde, volta ao orçamento: mensagem de data (sem dados) ou o que falta |
| Combinando a visita, com o dia junto | resposta e fecha a visita como antes |
| Depois da proposta / encerrada | só a resposta, sem handoff e sem puxar fluxo |
| Oferta do mini | como antes: PDF do mini e repasse à Raquel |
| Visita técnica, fornecedor, cliente fechada, negociação | a dúvida não interfere |

## Fora de escopo

- Follow-up 2 (uma semana): texto recebido, falta template da Meta.
- PDF ou valores de hospedagem de convidados: não existem nos PDFs atuais.

## Verificação

`test/faq.test.ts` (regras e decisão por estado) e cenários G01 a G07 em `tools/usabilidade/` contra o
Gemini real (todos como esperado; os 105 cenários da bateria rodaram sem erro).
