-- Fila de mensagens com delay proposital (a resposta não é instantânea).
-- O webhook enfileira; o /api/process consome os itens vencidos.

create table if not exists fila_mensagens (
  id             uuid primary key default gen_random_uuid(),
  telefone       text not null,
  tipo           text not null default 'texto' check (tipo in ('texto','audio')),
  conteudo       text not null,           -- texto da msg, ou media_id se áudio
  processar_apos timestamptz not null,    -- delay: now() + ~60s
  processado_em  timestamptz,
  criado_em      timestamptz not null default now()
);

create index if not exists fila_pendentes_idx
  on fila_mensagens (processar_apos)
  where processado_em is null;

alter table fila_mensagens enable row level security;

-- Agendamento do consumo a cada minuto (provisionar pg_cron + pg_net no Supabase):
--
--   select cron.schedule('processar-fila', '* * * * *', $$
--     select net.http_post(
--       url    := 'https://SEU-APP.vercel.app/api/process',
--       headers := jsonb_build_object('x-process-secret', 'SEGREDO')
--     );
--   $$);
