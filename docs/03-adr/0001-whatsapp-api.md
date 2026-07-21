# ADR-0001 — API do WhatsApp

**Status:** ACEITO (decisão do Matheus em 21/07)
**Data:** 21/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md)

## Decisão final (21/07)

**API oficial (WhatsApp Cloud API) com Coexistência**, conexão direta à Graph API (sem BSP de
taxa fixa). Motivos:

- **Coexistência** (recurso da Meta) permite manter o número no **app do WhatsApp da Raquel** E na
  API ao mesmo tempo. Ela continua atendendo pelo app quando quiser; o bot atende pela API. Isso
  derrubou o motivo que antes empurrava para a não-oficial.
- **Mesmo número para tudo** (decisão do Matheus): sem número dedicado, nem agora nem depois. A
  distinção lead novo x cliente já fechado é resolvida por **consulta ao banco** (telefone; e, para
  número novo, por nome/data), não por número separado.
- **Custo:** conversas iniciadas pelo cliente e respostas dentro da janela de 24h são **gratuitas**.
  Só há custo em mensagens que a empresa inicia fora da janela (templates), essencialmente o
  follow-up de lead sumido. Tarifas Brasil (confirmar na Meta): serviço grátis, utility R$ 0,0642,
  marketing R$ 0,5895 por mensagem.
- **Sem risco de banimento** (ao contrário da não-oficial), postura profissional e escalável.

Consequências operacionais:
- O **handoff não usa "não lida"** (a API oficial não tem isso) nem grupo de WhatsApp (a API oficial
  não envia/recebe em grupos). Com a coexistência, a conversa aparece no app da Raquel, então o
  alerta de handoff vai por **bot do Telegram** (chega no celular dela) e ela responde no app.
- **No MVP não há painel** (ver ADR-0004, revisão de 21/07): a Raquel atende pelo próprio app.
- Ressalva da coexistência: o número **não pode ser pareado no WhatsApp Web tradicional** ao mesmo tempo.
- Migrar o número atual para a Cloud API o desconecta do app durante o onboarding (combinar a transição).

O restante deste ADR registra o comparativo original que levou a esta decisão.

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
