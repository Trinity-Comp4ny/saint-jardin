// Regra do follow-up da proposta (Raquel, 14/10/2026). Funções puras: o job só
// consulta e envia, quem decide é este módulo.

import type { Conversa } from './types';

/** Espera depois do envio da proposta antes de perguntar se ficou dúvida. */
export const FOLLOWUP_APOS_HORAS = 12;

/**
 * Limite para o texto livre. A Meta só deixa o bot escrever sem template dentro
 * de 24h da última mensagem da pessoa; 30 min de folga cobrem o intervalo do cron.
 * Proposta enviada logo depois das 8h cujo prazo cai de madrugada pode perder o
 * follow-up: o dia seguinte já passou de 24h.
 */
export const FOLLOWUP_LIMITE_HORAS = 23.5;

/** Janela de envio em horário de Brasília: [início, fim). Evita mensagem de madrugada. */
export const JANELA_ENVIO = { inicio: 8, fim: 20 } as const;

const HORA_MS = 3_600_000;

/** Hora cheia (0-23) em Brasília. Sem horário de verão desde 2019, mas usa o fuso do sistema. */
export function horaEmBrasilia(iso: string): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
  return Number(h);
}

export function dentroDaJanelaDeEnvio(agoraISO: string): boolean {
  const h = horaEmBrasilia(agoraISO);
  return h >= JANELA_ENVIO.inicio && h < JANELA_ENVIO.fim;
}

/**
 * A retomada do orçamento está devida? É o follow-up de quem parou de responder ANTES da proposta:
 * ficou em `aguardando_qualificacao` (faltava data ou convidados). Mesmas regras de tempo do
 * follow-up da proposta, contadas da última mensagem da pessoa (é dela que a Meta conta as 24h).
 * `followupEnviadoEm` é zerado quando a proposta sai, então o follow-up da proposta segue valendo.
 */
export function retomadaDevida(c: Conversa, agoraISO: string): boolean {
  if (c.estado !== 'aguardando_qualificacao' || c.followupEnviadoEm || !c.ultimaEntradaEm) return false;
  const idadeHoras = (new Date(agoraISO).getTime() - new Date(c.ultimaEntradaEm).getTime()) / HORA_MS;
  if (idadeHoras < FOLLOWUP_APOS_HORAS || idadeHoras > FOLLOWUP_LIMITE_HORAS) return false;
  return dentroDaJanelaDeEnvio(agoraISO);
}

/**
 * O follow-up desta conversa está devido agora? Só em `proposta_enviada`, uma vez
 * por proposta, com a pessoa em silêncio desde o envio, passadas 12h e ainda
 * dentro das 24h da Meta, na janela de horário.
 */
export function followupDevido(c: Conversa, agoraISO: string): boolean {
  if (c.estado !== 'proposta_enviada') return false;
  if (!c.propostaEnviadaEm || c.followupEnviadoEm) return false;
  // Qualquer mensagem da pessoa depois da proposta cancela o follow-up.
  if (c.ultimaEntradaEm && c.ultimaEntradaEm > c.propostaEnviadaEm) return false;
  const idadeHoras = (new Date(agoraISO).getTime() - new Date(c.propostaEnviadaEm).getTime()) / HORA_MS;
  if (idadeHoras < FOLLOWUP_APOS_HORAS || idadeHoras > FOLLOWUP_LIMITE_HORAS) return false;
  return dentroDaJanelaDeEnvio(agoraISO);
}
