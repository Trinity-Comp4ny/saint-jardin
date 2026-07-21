-- Schema inicial do atendimento (ADR-0004). Região São Paulo, RLS ligado.
-- Fase 0 roda em memória; este schema é a base para a Fase 1 em diante.

create extension if not exists pgcrypto;

-- Contatos: leads e clientes já fechados (mesmo número recebe tudo).
create table if not exists contatos (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null unique,
  nome         text,
  status       text not null default 'lead' check (status in ('lead', 'fechado')),
  data_evento  text,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Estado da conversa (uma por contato/telefone).
create table if not exists conversas (
  id            uuid primary key default gen_random_uuid(),
  telefone      text not null unique,
  estado        text not null default 'novo'
                check (estado in ('novo','aguardando_qualificacao','aguardando_interesse_mini','proposta_enviada','handoff','humano')),
  slots         jsonb not null default '{}'::jsonb,
  motivo_handoff text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Log de mensagens (auditoria; áudio guarda o texto transcrito).
create table if not exists mensagens (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null,
  direcao      text not null check (direcao in ('entrada','saida')),
  tipo         text not null default 'texto' check (tipo in ('texto','pdf','audio')),
  conteudo     text,
  criado_em    timestamptz not null default now()
);
create index if not exists mensagens_telefone_idx on mensagens (telefone, criado_em);

-- Handoffs para o watchdog (re-alerta se ninguém responder).
create table if not exists handoffs (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null,
  motivo       text not null,
  status       text not null default 'aberto' check (status in ('aberto','resolvido')),
  criado_em    timestamptz not null default now(),
  resolvido_em timestamptz
);

-- Idempotência: a Meta reentrega webhook; evita processar a mesma msg 2x.
create table if not exists eventos_processados (
  message_id   text primary key,
  criado_em    timestamptz not null default now()
);

-- Cache de disponibilidade (espelho livre/ocupado do calendário dedicado).
create table if not exists disponibilidade (
  data         date primary key,
  ocupada      boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- Consentimento LGPD (aviso de privacidade no primeiro contato).
create table if not exists consentimentos (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null,
  aceito_em    timestamptz not null default now(),
  texto_versao text not null
);

-- RLS: nenhum acesso anônimo; o backend usa service role.
alter table contatos            enable row level security;
alter table conversas           enable row level security;
alter table mensagens           enable row level security;
alter table handoffs            enable row level security;
alter table eventos_processados enable row level security;
alter table disponibilidade     enable row level security;
alter table consentimentos      enable row level security;

-- Fila e agendamento no próprio Postgres (delay de ~1min, follow-up, cobrança):
--   create extension if not exists pgmq;
--   create extension if not exists pg_cron;
-- Provisionar via painel do Supabase (extensões) na Fase 1.
