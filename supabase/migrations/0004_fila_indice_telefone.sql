-- Índice para o rate limit por telefone (ADR-0009): a checagem de mensagens
-- recentes por número passa a rodar a cada webhook, então merece índice.
create index if not exists fila_telefone_criado_idx
  on fila_mensagens (telefone, criado_em);
