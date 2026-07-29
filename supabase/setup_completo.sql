-- Setup completo do Supabase para o Saint Jardin (Fase 1).
-- Cole tudo no SQL Editor do projeto e clique em "Run".
-- Idempotente: pode rodar de novo sem quebrar.

-- ===== Extensões =====
create extension if not exists pgcrypto;

-- ===== Contatos (leads e clientes já fechados) =====
create table if not exists contatos (
  id            uuid primary key default gen_random_uuid(),
  telefone      text not null unique,
  nome          text,
  status        text not null default 'lead' check (status in ('lead', 'fechado')),
  data_evento   text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ===== Conversas (estado da máquina de estados por telefone) =====
create table if not exists conversas (
  id             uuid primary key default gen_random_uuid(),
  telefone       text not null unique,
  estado         text not null default 'novo'
                 check (estado in ('novo','aguardando_qualificacao','aguardando_interesse_mini','proposta_enviada','handoff','humano')),
  slots          jsonb not null default '{}'::jsonb,
  motivo_handoff text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ===== Log de mensagens (auditoria; áudio guarda o texto transcrito) =====
create table if not exists mensagens (
  id        uuid primary key default gen_random_uuid(),
  telefone  text not null,
  direcao   text not null check (direcao in ('entrada','saida')),
  tipo      text not null default 'texto' check (tipo in ('texto','pdf','audio')),
  conteudo  text,
  criado_em timestamptz not null default now()
);
create index if not exists mensagens_telefone_idx on mensagens (telefone, criado_em);

-- ===== Handoffs (watchdog: re-alerta se ninguém responder) =====
create table if not exists handoffs (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null,
  motivo       text not null,
  status       text not null default 'aberto' check (status in ('aberto','resolvido')),
  criado_em    timestamptz not null default now(),
  resolvido_em timestamptz
);

-- ===== Idempotência do webhook (dedup por message_id) =====
create table if not exists eventos_processados (
  message_id text primary key,
  criado_em  timestamptz not null default now()
);

-- ===== Cache de disponibilidade (espelho livre/ocupado do calendário) =====
create table if not exists disponibilidade (
  data          date primary key,
  ocupada       boolean not null default false,
  atualizado_em timestamptz not null default now()
);

-- ===== Consentimento LGPD (aviso no primeiro contato) =====
create table if not exists consentimentos (
  id           uuid primary key default gen_random_uuid(),
  telefone     text not null,
  aceito_em    timestamptz not null default now(),
  texto_versao text not null
);

-- ===== Fila de mensagens com delay proposital =====
create table if not exists fila_mensagens (
  id             uuid primary key default gen_random_uuid(),
  telefone       text not null,
  tipo           text not null default 'texto' check (tipo in ('texto','audio')),
  conteudo       text not null,
  processar_apos timestamptz not null,
  processado_em  timestamptz,
  criado_em      timestamptz not null default now()
);
create index if not exists fila_pendentes_idx
  on fila_mensagens (processar_apos) where processado_em is null;

-- ===== RLS ligado em tudo (backend usa service role, que ignora RLS) =====
alter table contatos            enable row level security;
alter table conversas           enable row level security;
alter table mensagens           enable row level security;
alter table handoffs            enable row level security;
alter table eventos_processados enable row level security;
alter table disponibilidade     enable row level security;
alter table consentimentos      enable row level security;
alter table fila_mensagens      enable row level security;

-- ===== Bucket privado dos PDFs =====
insert into storage.buckets (id, name, public)
values ('propostas', 'propostas', false)
on conflict (id) do nothing;
