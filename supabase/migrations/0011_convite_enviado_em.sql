-- Convite de visita 5 minutos depois da proposta (pedido da Raquel, 16/10/2026).
-- `convite_enviado_em` nulo depois de uma proposta = convite ainda pendente.
alter table conversas
  add column if not exists convite_enviado_em timestamptz;

-- Propostas que já saíram antes desta migration levaram o convite junto: contam como enviado,
-- senão o job mandaria o convite de novo para todas elas.
update conversas
   set convite_enviado_em = proposta_enviada_em
 where proposta_enviada_em is not null
   and convite_enviado_em is null;

-- O job só olha conversas em proposta_enviada com convite pendente: índice parcial pequeno.
create index if not exists conversas_convite_idx
  on conversas (proposta_enviada_em)
  where estado = 'proposta_enviada' and convite_enviado_em is null;
