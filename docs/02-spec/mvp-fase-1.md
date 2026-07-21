# Spec — MVP Fase 1: Chatbot de primeiro atendimento

**Status:** rascunho, aguardando decisões pendentes
**Data:** 21/07/2026
**Autor:** Matheus
**Depende de:** [ADR-0001](../03-adr/0001-whatsapp-api.md), [ADR-0002](../03-adr/0002-calendario-dedicado.md), [ADR-0003](../03-adr/0003-dados-estruturados-plataforma.md)

---

## 1. Problema

O Saint Jardin recebe muitas mensagens de noivas no WhatsApp pedindo preço e informação. A maior
parte é curioso que não avança, e responder um a um consome o tempo da Raquel. O primeiro atendimento
é totalmente roteirizado (mesma sequência de mensagens e PDFs), então é automatizável sem perder
qualidade.

## 2. Objetivo

Uma IA que atende o **primeiro contato de noivas** no WhatsApp, se passando pela atendente, até o ponto
em que precisa de decisão humana. Ela informa preço/data, checa disponibilidade no calendário, envia os
documentos certos e transbordar para a Raquel no momento adequado.

## 3. Métricas de sucesso

- % de primeiros atendimentos resolvidos sem a Raquel tocar (qualificação + orçamento + PDF enviados).
- Redução do tempo da Raquel gasto com curiosos.
- Tempo até a primeira resposta ao lead (deve ser rápido, mas com delay proposital, ver §6).
- Nº de visitas agendadas via IA.
- Zero cliente já fechado atendido incorretamente pela IA.

## 4. Escopo (dentro / fora)

### Dentro do MVP
- Receber mensagem de lead novo e conduzir o fluxo de atendimento (§5).
- Entender **texto e áudio** (transcrição de áudio da noiva).
- Enviar os textos prontos e os **PDFs** corretos conforme a ramificação (sáb/dom/sex x dia de semana,
  2027 x 2028, mini wedding).
- Informar **preço de tabela** (nunca inventado).
- Checar **disponibilidade de data** em um calendário dedicado e **sugerir data alternativa** se ocupada.
- **Handoff** para a Raquel quando: cliente quer agendar visita, quer negociar valor/condição, faz
  pergunta fora do script, ou é identificado como cliente já fechado.
- Não atender número de **cliente já fechado** (ver §7).
- Persona única e consistente (§6).

### Fora do MVP (backlog futuro)
- Lançar evento/pagamento no calendário ao fechar contrato.
- Agendamento de visita técnica + relatório diário no grupo de funcionários.
- Follow-up automático de lead sumido (~1 semana). *Preparar o gancho, mas ligar depois.*
- Cobrança automatizada (dia 20).
- Plataforma de administração (calendário + financeiro + banco + estoque).

## 5. Fluxo do atendimento

Baseado no script atual da Raquel ([material-whatsapp.md §1](../01-descoberta/material-whatsapp.md)).

```
Lead novo → [checa: número é cliente fechado?]
  → sim: não responde, notifica a Raquel (handoff)
  → não: segue

1. Saudação institucional + apresentação (persona) + envia PDF de apresentação
2. Pergunta qualificadora: data + ano + dia da semana + nº de convidados
3. Recebe resposta (texto ou áudio → transcreve)
4. Ramifica:
   - sáb/dom/sex, +80 pessoas, 2027|2028 → texto de orçamento + PDF da proposta do ano
     └ se cliente citou data específica → checa disponibilidade; se ocupada → sugere data
   - dia de semana OU <80 pessoas → oferece mini wedding → se aceita, envia proposta mini wedding
5. Convida para visita
6. Quando cliente quer marcar visita / negociar / sai do script → HANDOFF para a Raquel
```

### Máquina de estados da conversa
`novo → apresentado → qualificado → orçamento_enviado → (visita | negociação → HANDOFF) → fechado`

## 6. Persona e comportamento

- **Nome único** a definir (hoje aparece "Raquel" e "Ana" — padronizar). Ver ADR-0003.
- Não revela em nenhum momento que é uma IA.
- **Delay proposital** entre receber e responder (~1 min, com variação) para não parecer bot.
- Tom da Raquel: cordial, "você", emoji pontual (☺️), sem formalidade excessiva.
- Reusa os **textos prontos** da Raquel literalmente onde existirem.

## 7. Regras críticas (guardrails)

1. **Nunca inventar preço.** Só valores da tabela oficial (ADR-0003). Se não souber, handoff.
2. **Nunca dar desconto nem negociar condição.** Negociação de valor/prazo → handoff.
3. **Nunca atender cliente já fechado.** Se o número está na base de clientes fechados, não responde
   e notifica a Raquel. Se um número novo se identificar como cliente ("sou a noiva do dia tal"),
   também faz handoff.
4. **Disponibilidade só do calendário dedicado** (nunca da agenda pessoal da Raquel). ADR-0002.
5. Em dúvida sobre qualquer coisa fora do script, **handoff** em vez de improvisar.

## 8. Componentes

```
WhatsApp (ADR-0001)
  → Agente LLM (Claude): persona + regras + tabela de preços + textos prontos + FAQ
  → Ferramentas:
       checar_disponibilidade(data)        → Google Calendar dedicado (ADR-0002)
       sugerir_datas_proximas(data)
       enviar_pdf(tipo)                     → apresentacao | 2027 | 2028 | mini_wedding
       transcrever_audio(audio)            → Whisper
       eh_cliente_fechado(numero)          → base de clientes
       handoff(conversa, motivo)           → notifica a Raquel (canal em ADR-0001)
  → Persistência: leads, estado da conversa, histórico (ADR-0003)
```

## 9. Critérios de aceite

- [ ] Lead novo recebe saudação + apresentação + PDF sem intervenção humana.
- [ ] A IA pergunta e interpreta corretamente data, dia da semana e nº de convidados (inclusive por áudio).
- [ ] Ramificação correta: evento normal x mini wedding; ano 2027 x 2028; PDF certo enviado.
- [ ] Preço informado bate com a tabela oficial (nunca inventado).
- [ ] Data ocupada → IA sugere alternativa próxima disponível.
- [ ] Pedido de visita, negociação, ou pergunta fora do script → handoff notifica a Raquel.
- [ ] Número de cliente já fechado nunca é atendido pela IA.
- [ ] Respostas saem com delay (não instantâneas).
- [ ] Persona consistente (um nome só, sem revelar IA).

## 10. Decisões pendentes (bloqueiam o início)

Levar para a Raquel antes de codar:

1. **Número de WhatsApp:** usar o mesmo que hoje recebe tudo (inclusive clientes fechados) ou um número
   novo dedicado a leads? Impacta ADR-0001 e a regra 3. *Recomendação: número novo dedicado.*
2. **API do WhatsApp:** oficial (Meta/BSP) x não-oficial. Ver ADR-0001. Impacta custo, risco e handoff.
3. **Como notificar o handoff:** "não lida" não existe na API oficial. Definir canal (painel, grupo
   interno, notificação). Ver ADR-0001.
4. **Tabela de preços completa:** confirmar valores de 2028 (todos os pacotes) e de domingo/sexta.
   Ver ADR-0003.
5. **Texto do follow-up** de "leu e não respondeu" (a Raquel disse que já tem).
6. **Nome único da persona.**
7. Confirmar nº de funcionários por evento normal (prints citam 2 e 3 em contextos diferentes).

## 11. Próximos passos

1. Fechar as decisões pendentes com a Raquel.
2. Montar a tabela de preços estruturada (fonte de verdade).
3. Escolher a API do WhatsApp e provisionar o número.
4. Prototipar o agente com o calendário de teste do Matheus antes de conectar o dos clientes.
