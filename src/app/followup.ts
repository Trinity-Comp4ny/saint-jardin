// Follow-up da proposta: 12h depois do envio, se a pessoa não escreveu, pergunta
// se ficou dúvida e convida para a visita. Chamado pelo mesmo cron de /api/process.

import { followupDevido, dentroDaJanelaDeEnvio, FOLLOWUP_APOS_HORAS, FOLLOWUP_LIMITE_HORAS } from '../domain/followup';
import { MSG } from '../domain/persona';
import { adiarISO } from './pipeline';
import type { Deps } from './orchestrator';

const HORA_S = 3600;

/** Envia os follow-ups devidos. Retorna quantos foram enviados. */
export async function processarFollowups(deps: Deps): Promise<number> {
  const agora = deps.agora();
  // Fora da janela de horário nem consulta o banco.
  if (!dentroDaJanelaDeEnvio(agora)) return 0;

  const candidatas = await deps.conversas.pendentesDeFollowup(
    adiarISO(agora, -FOLLOWUP_LIMITE_HORAS * HORA_S),
    adiarISO(agora, -FOLLOWUP_APOS_HORAS * HORA_S),
  );

  let enviados = 0;
  for (const conversa of candidatas) {
    if (!followupDevido(conversa, agora)) continue;
    // Atômico: dois ciclos do cron sobrepostos não mandam o mesmo follow-up 2x.
    if (!(await deps.conversas.reivindicarFollowup(conversa.telefone, agora))) continue;
    try {
      await deps.messaging.enviar(conversa.telefone, [{ tipo: 'texto', texto: MSG.followUp }]);
    } catch (erro) {
      // Falhou o envio: solta a reivindicação para o próximo ciclo tentar de novo.
      console.error(`processarFollowups: falha enviando para ${conversa.telefone}`, erro);
      await deps.conversas.liberarFollowup(conversa.telefone);
      continue;
    }
    try {
      await deps.mensagens?.registrar(conversa.telefone, 'saida', 'texto', MSG.followUp);
    } catch {
      // Só o histórico fica incompleto: a mensagem já foi enviada.
    }
    enviados++;
  }
  return enviados;
}
