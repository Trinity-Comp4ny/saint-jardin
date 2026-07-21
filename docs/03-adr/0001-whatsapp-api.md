# ADR-0001 — API do WhatsApp

**Status:** proposto (aguardando decisão da Raquel)
**Data:** 21/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md)

## Contexto

O chatbot precisa enviar e receber mensagens no WhatsApp. Existem dois caminhos, e a escolha
define custo, risco de banimento, e o que é possível fazer no handoff e no follow-up.

Requisitos que puxam a decisão:
- Enviar texto, PDF e receber áudio.
- Iniciar/reengajar conversa depois de 24h (follow-up de lead sumido, fase futura).
- Sinalizar handoff para a Raquel.
- A IA se passa por humana (sem revelar que é bot).

### Opção A — API oficial (WhatsApp Business Platform, via Meta ou um BSP)
- **Prós:** estável, sem risco de banimento, escala, selo verde possível, suporte a mídia.
- **Contras:**
  - Fora da janela de 24h só dá para iniciar conversa com **template aprovado (HSM)**, com custo
    por conversa. Afeta o follow-up automático.
  - **Não existe** "marcar conversa como não lida" por API. A ideia de handoff da Raquel não funciona
    como imaginado; precisa de outro sinal.
  - Onboarding mais burocrático (número, verificação de negócio).

### Opção B — API não-oficial (ex.: Evolution API sobre WhatsApp Web)
- **Prós:** flexível, mais barata, permite ações que a oficial não permite, iniciar conversa livre.
- **Contras:** **risco real de banimento** do número, contra os termos do WhatsApp, menos estável,
  responsabilidade operacional maior.

## Decisão

**Pendente.** Recomendação inicial: **começar com a API oficial** para proteger o número do negócio,
e resolver handoff/follow-up com os mecanismos da própria plataforma (ver consequências). Reavaliar
se o custo por conversa ou as limitações inviabilizarem o follow-up.

Decisão dependente de: qual número será usado (ver decisão pendente #1 da spec) e apetite a risco.

## Consequências

- **Handoff:** como "não lida" não existe na oficial, o sinal para a Raquel será um dos: (a) mensagem
  num grupo/chat interno de WhatsApp com link da conversa, (b) notificação num painel simples, (c)
  e-mail/push. Definir com a Raquel. Enquanto não há plataforma, a opção (a) é a mais barata.
- **Follow-up (fase futura):** precisará de template aprovado; planejar o texto e a aprovação com
  antecedência.
- **Número dedicado:** recomendado usar um número novo só para leads novos, separado do número pessoal
  da Raquel que recebe clientes fechados. Isso simplifica a regra "não atender cliente fechado".
- Se optar pela não-oficial, isolar o número (não usar o principal do negócio) para limitar o dano de
  um eventual banimento.
