-- Trava por telefone: só um turno do bot por vez para o mesmo número.
-- Sem ela, duas mensagens seguidas rodavam em paralelo e a segunda lia o estado
-- da conversa antes de a primeira salvar (saudação repetida, data perdida).
-- A linha some ao fim do turno; `expira_em` cobre o turno que morreu sem liberar.
create table if not exists turno_trava (
  telefone  text primary key,
  dono      text not null,
  expira_em timestamptz not null
);

alter table turno_trava enable row level security;
