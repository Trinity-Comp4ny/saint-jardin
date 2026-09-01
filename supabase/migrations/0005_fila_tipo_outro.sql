-- Antes, mensagem de tipo não suportado (figurinha, reação, imagem, documento,
-- localização etc.) virava `tipo: 'outro'` no parser e era DESCARTADA sem
-- resposta nenhuma (`ingerirWebhook: if (msg.tipo === 'outro') continue`). A
-- noiva que reage com 👍 achando que respondeu ficava sem retorno, achando que
-- travou. Agora esse tipo também entra na fila, pra o bot avisar que só
-- entende texto/áudio, em vez de ficar muda.
alter table fila_mensagens drop constraint fila_mensagens_tipo_check;
alter table fila_mensagens
  add constraint fila_mensagens_tipo_check check (tipo in ('texto', 'audio', 'outro'));
