-- #reset (modo teste) passa a ARQUIVAR o histórico em vez de apagar: o contexto
-- ativo some para a NLU/Redator (o nome antigo não ressuscita), mas as conversas
-- de teste continuam no banco para análise.
alter table mensagens
  add column if not exists arquivada boolean not null default false;

create index if not exists mensagens_ativas_idx
  on mensagens (telefone, criado_em)
  where not arquivada;
