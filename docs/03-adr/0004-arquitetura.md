# ADR-0004 — Arquitetura do sistema

**Status:** ACEITO com revisões (decisões do Matheus em 21/07)
**Data:** 21/07/2026
**Contexto do projeto:** [MVP Fase 1](../02-spec/mvp-fase-1.md)
**Relacionado:** [ADR-0001](0001-whatsapp-api.md), [ADR-0002](0002-calendario-dedicado.md), [ADR-0003](0003-dados-estruturados-plataforma.md)

## Revisão 21/07 (o que mudou na recomendação do painel)

Decisões do Matheus depois do painel, que ajustam a arquitetura abaixo:

1. **WhatsApp: API oficial + Coexistência** (ver ADR-0001). A Raquel mantém o número no app dela.
2. **Mesmo número para tudo, sem número dedicado.** A distinção lead x cliente fechado é por
   **consulta ao banco** (telefone; e por nome/data quando vem de número novo). Já implementado no
   orquestrador (`buscarPorTelefone` / `buscarPorNomeOuData`).
3. **Sem painel no MVP.** Como a coexistência faz a conversa aparecer no app da Raquel, no handoff ela
   atende pelo próprio app. O **alerta vai por bot do Telegram**. O painel/CRM vira fase futura.
4. **Handoff sem "não lida" e sem grupo de WhatsApp** (a API oficial não suporta). Alerta = Telegram.
5. **Barateamento (LLM mínimo):** a máquina de estados envia os textos prontos **sem LLM**; o Claude
   (**Haiku 4.5**) entra só para ler a mensagem (extrair dados, classificar intenção). Custo por
   conversa em centavos. Sonnet fica opcional para redação futura.
6. **Custo WhatsApp:** atendimento na janela de 24h é grátis; só follow-up (template) custa.

O corpo abaixo é a recomendação original do painel; onde houver conflito, vale esta revisão.
As tabelas `interface_raquel`/painel referem-se à fase futura, não ao MVP.

## Como esta decisão foi tomada

Painel multi-agente: 3 arquitetos propuseram soluções por filosofias distintas
(managed/low-code, custom na stack do dono, híbrido pragmático), 3 críticos debateram cada
proposta por lentes diferentes (manutenção por dev solo, custo/escala/confiabilidade, fit para
a Raquel + LGPD + ToS + ambiente de teste), e um arquiteto-chefe sintetizou a recomendação.

**Consenso do debate:**
- **Descartado n8n / low-code** (Proposta A): "canvas espaguete" versionado por JSON export, ferramenta
  fora do domínio do Matheus, debug saltando entre 4-5 SaaS. Ótimo time-to-live, péssima manutenção
  git-native para um dev.
- **Descartado Chatwoot self-host**: operar Rails/Redis/Sidekiq é inviável para dev solo.
- **Descartada API não-oficial** (Evolution/Baileys): fere o ToS, risco de banimento do número.
- **Base vencedora:** custom na stack do Matheus (Next.js + Supabase + Anthropic SDK + WhatsApp
  Cloud API oficial), com dois transplantes do híbrido: **fila durável no próprio Postgres**
  (pgmq + pg_cron, no lugar de serviço externo) e **uma porta fina de canal** (`MessagingProvider`)
  para poder trocar/testar o WhatsApp sem reescrever o agente.

## Decisão

Construir tudo na stack que o Matheus domina, com o **cérebro do fluxo como máquina de estados
determinística em TypeScript** e o **Claude só como NLU** (extrair dados, classificar intenção) e
redator da persona. O agente **nunca toca em preço**: apenas roteia a conversa e envia o PDF certo.

### Stack recomendada

| Camada | Escolha |
|---|---|
| **WhatsApp** | Cloud API oficial da Meta (Graph API direta). Número **novo dedicado só a leads** (separa por construção o cliente já fechado). BSP 360dialog pay-as-you-go só como plano B se o onboarding travar. |
| **Backend** | Next.js (App Router) na Vercel, base única de código. `/api/whatsapp` (webhook) e `/api/process` (lógica do fluxo). |
| **Delay de ~1min** | **Não** é sleep serverless: é *visibility delay* no **pgmq** (fila durável no Postgres) + **pg_cron** disparando `/api/process` a cada minuto via pg_net. |
| **LLM** | `@anthropic-ai/sdk` cru com tool use, sem LangChain. **Haiku 4.5** para extração de slots e classificação (structured outputs); **Sonnet** só na redação final da voz da Raquel. System prompt fixo com prompt caching. |
| **Dados** | Supabase Postgres **região São Paulo** (LGPD), RLS ligado, **Zod** validando o payload da Meta na fronteira. |
| **Storage PDF** | Supabase Storage, bucket privado com os 4 PDFs. Envio como *document message* via signed URL. Trocar preço = subir novo PDF, sem deploy. |
| **Interface da Raquel** | Painel Next.js (PWA) com Supabase Auth (ela só loga) + inbox ao vivo via Supabase Realtime. No handoff ela responde de dentro do painel, saindo pelo **mesmo número** via Cloud API. |
| **Alerta de handoff** | **Bot do Telegram** (primário, chega no celular dela, grátis, confiável) + web push como redundância. **Watchdog**: handoff aberto sem resposta re-alerta. |
| **Observabilidade** | Sentry + uptime ping externo + heartbeat dos jobs pg_cron/pgmq (falha silenciosa de cron é clássica). |
| **Deploy** | Vercel (app + webhook + painel) + Supabase. Preview deployments + branch de banco como staging. Dois provedores, ambos no ferramental do Matheus. |

### Modelo de dados (tabelas)
`leads`, `conversations` (coluna `state` da máquina de estados), `messages` (in/out, texto e áudio
transcrito), `handoffs` (motivo, status, timestamps para o watchdog), `closed_clients`,
`availability_cache` (espelho livre/ocupado do calendário), `consents` (aviso de privacidade +
consentimento com timestamp), `processed_events` (idempotência por `message_id`).

### Máquina de estados
`novo → apresentado → qualificado → proposta_enviada → (visita | negociação → handoff) → fechado`

### Tools do agente (1:1 com a spec)
`extrair_slots`, `checar_disponibilidade(data)`, `sugerir_data_proxima(data)`, `enviar_pdf(tipo)`,
`eh_cliente_fechado(numero)`, `handoff(motivo)`.

## Fluxo de dados (mensagem → resposta/handoff)

1. Lead manda mensagem (texto/áudio) para o número de leads; a Meta chama `/api/whatsapp`.
2. Webhook valida assinatura (`X-Hub-Signature-256`) e verify token, valida shape com Zod, checa
   idempotência por `message_id`, grava inbound, **enfileira** job no pgmq com delay ~60s + jitter e
   responde **200 imediato** (evita reentrega da Meta).
3. Se áudio: baixa o `.ogg/opus` do endpoint de mídia da Meta e transcreve (Groq Whisper large-v3, PT-BR).
4. pg_cron dispara `/api/process` a cada minuto, puxando jobs prontos.
5. `/api/process` carrega o estado; **primeiro** checa `eh_cliente_fechado` (se for, handoff direto,
   sem persona); depois aplica a **guarda da janela de 24h**.
6. Haiku extrai slots (data, ano, dia da semana, nº convidados) e classifica intenção.
7. A máquina de estados decide a transição e a ação (saudação, apresentação + PDF, coleta,
   ramificação 2027/2028 x mini wedding, convite à visita, ou handoff).
8. Para data, tool consulta o Google Calendar dedicado (freebusy) com cache; se ocupada, sugere data.
9. Sonnet redige na voz da Raquel; envia pelo `CloudApiProvider` (texto e/ou PDF). Fora da janela de
   24h, a guarda troca por template HSM aprovado.
10. Grava outbound e atualiza `conversations.state`.
11. Handoff: `state=human`, IA para de responder aquele número, alerta no Telegram (+ web push) com
    link para a thread; watchdog re-alerta se ninguém responder. A Raquel responde pelo painel, saindo
    pelo mesmo número.

## Ambiente de teste (sem número real)

Quatro camadas, nenhuma toca produção:
1. **Testes unitários da máquina de estados** no CI (LLM está fora dela, então é determinística):
   cada ramificação (2027/2028, mini wedding, data ocupada, gatilhos de handoff) sem chamar Claude nem WhatsApp.
2. **SandboxProvider** implementando a mesma interface `MessagingProvider`: uma tela `/sandbox` injeta
   mensagens no mesmo `/api/process`, exercitando fluxo, tools, fila, transcrição (fixtures de áudio) e
   envio de PDF, renderizando o que sairia. Sem número real.
3. **Test phone number** do Meta App Dashboard (dev mode, grátis, até 5 destinatários verificados): valida
   o caminho real que o mock não cobre (download de mídia, transcrição de opus PT-BR, janela de 24h, template).
4. **Preview deployments** do Vercel + branch de banco do Supabase como staging.

Só depois de tudo verde (com dedup, guarda de janela e alerta de handoff testados) conecta o número real.

## Roadmap incremental

- **Fase 0 — Fundação (sem WhatsApp):** schema Supabase (SP, RLS), máquina de estados em TS com testes,
  SandboxProvider + tela `/sandbox`, upload dos 4 PDFs, Zod na fronteira. Fluxo ponta a ponta 100% mockado.
- **Fase 1 — Canal em sandbox:** Cloud API com test number, webhook com dedup, pgmq + pg_cron (delay),
  transcrição de áudio, envio de PDF, tool de calendário freebusy, painel básico (Auth + Realtime).
- **Fase 2 — Confiabilidade e go-live:** guarda da janela de 24h + template, alerta Telegram + web push,
  watchdog, heartbeat, Sentry, uptime. Aviso de privacidade + consentimento, detecção de cliente fechado,
  disclosure sutil de automação. **Conecta o número real.**
- **Fase 3 — CRM da Raquel:** gestão de leads no painel + follow-up de lead sumido (~1 semana) via template.
- **Fase 4 — Plataforma admin:** calendário, financeiro, estoque e conexão bancária como novas *portas*
  (`PaymentPort`/Stripe, `BankingPort`, `InventoryPort`) reusando o mesmo Postgres/Auth/Storage/Realtime.
  Cobrança automatizada dia 20 via pg_cron. **O núcleo do agente não é reescrito.**

## Custo estimado (MVP)
Baixo: Vercel + Supabase em free/pro tiers, Anthropic ~USD 5-20/mês, Groq Whisper ~USD 1-5/mês,
Cloud API (conversas de serviço iniciadas pelo lead na janela de 24h são gratuitas). Custo de
mensageria só aparece no follow-up futuro (template HSM). Sem piso fixo de BSP.

## Riscos (herdados para acompanhar)
- **ToS do WhatsApp + LGPD:** persona se passando por humana com delay artificial fere a policy da Meta e
  o princípio de boa-fé da LGPD (Art. 6). Não é mitigável pela arquitetura; mitigar com handoff rápido e
  **disclosure sutil de automação** (decisão de negócio da Raquel).
- **Alerta de handoff silencioso:** lead quente esfria sem erro. Mitigado por canal duplo + watchdog.
- **Janela de 24h vs delay:** resposta pode cair fora da janela. Guarda explícita + fallback de template.
- **Idempotência:** a Meta reentrega webhook; sem dedup por `message_id`, lead duplicado e PDF enviado 2x.
- **Cron/fila que para sem avisar:** heartbeat + uptime monitor obrigatórios.
- **Cliente fechado de número novo:** número dedicado reduz, não elimina.
- **Consentimento/base legal:** capturar aviso de privacidade + consentimento com timestamp no 1º contato.
- **Áudio real ≠ mock:** só o test number da Meta cobre opus/PT-BR; testar antes do go-live.

## Decisões ainda abertas
- Graph API direta (recomendado, sem piso de custo) x 360dialog pay-as-you-go (plano B se onboarding travar).
- Consumer do pgmq: pg_cron + pg_net chamando `/api/process` (recomendado) x Edge Function Deno.
- Canal do alerta de handoff: Telegram (recomendado) x template no WhatsApp pessoal dela. Validar qual ela abre.
- Persona: Sonnet só na fala (recomendado) x Haiku em tudo. Medir custo real por conversa.
- Disclosure de automação: quanto revelar. Decisão de negócio da Raquel.
- Transcrição: Groq Whisper (recomendado) x OpenAI. Ambos entram no DPA de LGPD.
- Retenção de PII: definir prazo e política de expurgo de mensagens/transcrições.
