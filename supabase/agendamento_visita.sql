-- ADR-0005: agendamento de visita de noiva.
-- Tabela de horários de visita marcados (fonte de ocupação da AgendaVisita) +
-- campo na conversa para lembrar o horário já oferecido, aguardando confirmação.

create table if not exists public.visitas (
  id uuid primary key default gen_random_uuid(),
  -- slot "YYYY-MM-DDTHH:mm" (horário local). unique = não marca o mesmo 2x.
  inicio text not null unique,
  telefone text not null,
  nome text,
  status text not null default 'agendada',
  criado_em timestamptz not null default now()
);

create index if not exists visitas_inicio_idx on public.visitas (inicio);

alter table public.visitas enable row level security;
-- Sem policy: apenas a service role (backend) acessa. Nega acesso anônimo/público.

alter table public.conversas
  add column if not exists visita_proposta text;
