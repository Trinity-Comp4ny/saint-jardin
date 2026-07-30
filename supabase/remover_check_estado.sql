-- Corrige bug crítico: o CHECK de `estado` só listava os estados antigos, então
-- salvar um estado novo (aguardando_pref_visita, aguardando_confirmacao_normal,
-- aguardando_data_normal, visita_tecnica_data) violava a constraint e a conversa
-- ficava presa no estado anterior.
--
-- A fonte da verdade dos estados é o tipo EstadoConversa (TypeScript). Manter uma
-- cópia no banco exige sincronizar à mão e já falhou silenciosamente, então
-- removemos o CHECK em vez de recriá-lo.

alter table public.conversas drop constraint if exists conversas_estado_check;
