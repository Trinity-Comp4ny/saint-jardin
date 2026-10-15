-- Alinha a pasta de migrations com o banco de produção. Duas mudanças foram
-- aplicadas à mão, fora da pasta, e um banco montado só pelas migrations não as
-- teria:
--
-- 1. supabase/remover_check_estado.sql: o CHECK de `conversas.estado` (criado em
--    0001) travava o salvamento de estados novos. A fonte da verdade dos estados
--    é o tipo EstadoConversa (TypeScript).
-- 2. supabase/agendamento_visita.sql: tabela `visitas` e `conversas.visita_proposta`
--    (ADR-0005, funcionalidade guardada, mas o banco já as tem).
--
-- Tudo idempotente: em produção é no-op.

alter table public.conversas drop constraint if exists conversas_estado_check;

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

alter table public.conversas
  add column if not exists visita_proposta text;
