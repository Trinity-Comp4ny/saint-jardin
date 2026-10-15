-- Fluxo v2 (14/10/2026): follow-up de 12h depois da proposta e vídeo de apresentação.

-- Datas que o job de follow-up usa (ver src/domain/followup.ts).
alter table conversas
  add column if not exists ultima_entrada_em  timestamptz,
  add column if not exists proposta_enviada_em timestamptz,
  add column if not exists followup_enviado_em timestamptz;

-- O job só olha conversas em proposta_enviada sem follow-up: índice parcial pequeno.
create index if not exists conversas_followup_idx
  on conversas (proposta_enviada_em)
  where estado = 'proposta_enviada' and followup_enviado_em is null;

-- O log de mensagens passa a registrar o vídeo enviado. Sem isso o insert falha
-- (o orquestrador ignora a falha, mas o histórico perderia a mensagem).
alter table mensagens drop constraint if exists mensagens_tipo_check;
alter table mensagens
  add constraint mensagens_tipo_check check (tipo in ('texto', 'pdf', 'audio', 'video'));
