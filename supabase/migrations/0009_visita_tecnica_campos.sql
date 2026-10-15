-- Visita técnica: a data do casamento que o fornecedor atende e a data da visita que ele
-- quer eram lidas como uma só. Agora são campos próprios, espelhados em colunas para a
-- Raquel filtrar e ler no painel do banco. A fonte da verdade segue em conversas.slots.
alter table conversas
  add column if not exists data_visita_tecnica date,
  add column if not exists data_casamento      date,
  add column if not exists casamento_noivos    text,
  add column if not exists fornecedor_servico  text;

comment on column conversas.data_visita_tecnica is 'Visita técnica: data pedida pelo fornecedor para a visita (validada: terça a sexta, 30 dias).';
comment on column conversas.data_casamento      is 'Visita técnica: data do casamento que o fornecedor atende. Só preenchida quando o ano foi dito.';
comment on column conversas.casamento_noivos    is 'Visita técnica: nome dos noivos do casamento que o fornecedor atende.';
comment on column conversas.fornecedor_servico  is 'Visita técnica: o que o fornecedor presta (buffet, decoração, fotografia...).';
