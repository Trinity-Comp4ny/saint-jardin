// Follow-ups de 12h, chamados pelo mesmo cron de /api/process:
//  - da proposta: a pessoa recebeu a proposta e não escreveu; pergunta se ficou dúvida e convida
//    para a visita;
//  - da retomada: a pessoa parou de responder ANTES da proposta (faltava data ou convidados);
//    pergunta se quer retomar o orçamento.

import {
  dentroDaJanelaDeEnvio,
  followupDevido,
  retomadaDevida,
  FOLLOWUP_APOS_HORAS,
  FOLLOWUP_LIMITE_HORAS,
} from '../domain/followup';
import { MSG } from '../domain/persona';
import type { Conversa } from '../domain/types';
import { adiarISO } from './pipeline';
import type { Deps } from './orchestrator';

const HORA_S = 3600;

/** Envia um follow-up por candidata, com a reivindicação atômica. Retorna quantos saíram. */
async function enviarFollowups(
  deps: Deps,
  candidatas: Conversa[],
  devido: (c: Conversa) => boolean,
  reivindicar: (telefone: string) => Promise<boolean>,
  texto: string,
): Promise<number> {
  let enviados = 0;
  for (const conversa of candidatas) {
    if (!devido(conversa)) continue;
    // Atômico: dois ciclos do cron sobrepostos não mandam o mesmo follow-up 2x.
    if (!(await reivindicar(conversa.telefone))) continue;
    try {
      await deps.messaging.enviar(conversa.telefone, [{ tipo: 'texto', texto }]);
    } catch (erro) {
      // Falhou o envio: solta a reivindicação para o próximo ciclo tentar de novo.
      console.error(`processarFollowups: falha enviando para ${conversa.telefone}`, erro);
      await deps.conversas.liberarFollowup(conversa.telefone);
      continue;
    }
    try {
      await deps.mensagens?.registrar(conversa.telefone, 'saida', 'texto', texto);
    } catch {
      // Só o histórico fica incompleto: a mensagem já foi enviada.
    }
    enviados++;
  }
  return enviados;
}

/** Envia os follow-ups devidos (proposta e retomada). Retorna quantos foram enviados. */
export async function processarFollowups(deps: Deps): Promise<number> {
  const agora = deps.agora();
  // Fora da janela de horário nem consulta o banco.
  if (!dentroDaJanelaDeEnvio(agora)) return 0;

  const desde = adiarISO(agora, -FOLLOWUP_LIMITE_HORAS * HORA_S);
  const ate = adiarISO(agora, -FOLLOWUP_APOS_HORAS * HORA_S);

  const daProposta = await enviarFollowups(
    deps,
    await deps.conversas.pendentesDeFollowup(desde, ate),
    (c) => followupDevido(c, agora),
    (telefone) => deps.conversas.reivindicarFollowup(telefone, agora),
    MSG.followUp,
  );

  // Isolado: uma falha na retomada não derruba o resultado do follow-up da proposta.
  let daRetomada = 0;
  try {
    daRetomada = await enviarFollowups(
      deps,
      await deps.conversas.pendentesDeRetomada(desde, ate),
      (c) => retomadaDevida(c, agora),
      (telefone) => deps.conversas.reivindicarRetomada(telefone, agora, ate),
      MSG.retomarOrcamento,
    );
  } catch (erro) {
    console.error('processarFollowups: falha na retomada do orçamento', erro);
  }
  return daProposta + daRetomada;
}
