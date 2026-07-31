-- Guarda o id da mensagem da Cloud API na fila, para marcá-la como LIDA no fim
-- do turno: conversa resolvida pelo bot vira lida (some das não lidas da Raquel);
-- a que precisa dela fica não lida. Coluna anulável: itens antigos seguem válidos.

alter table fila_mensagens
  add column if not exists mensagem_id text;
