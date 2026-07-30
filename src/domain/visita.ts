// Regras e utilidades da visita de noiva (ADR-0005 / spec agendamento-visita).
// Puras: geram os horários candidatos a partir das janelas e formatam para humano.
// O adapter (Supabase/Google) só subtrai os horários já ocupados.

import type { DiaSemana, PreferenciaVisita } from './types';

// getDay(): 0=domingo ... 6=sábado.
const DOW: DiaSemana[] = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DOW_LABEL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
];

/**
 * Janelas em que o bot pode oferecer visita, por dia da semana (horas inteiras).
 * CONFIRMAR COM A RAQUEL: default provisório dos docs (sábado de manhã e seg-sex
 * comercial, pulando o almoço). Ajustar aos horários reais antes do go-live.
 */
export const JANELAS_VISITA: Partial<Record<DiaSemana, number[]>> = {
  segunda: [9, 10, 11, 14, 15, 16],
  terca: [9, 10, 11, 14, 15, 16],
  quarta: [9, 10, 11, 14, 15, 16],
  quinta: [9, 10, 11, 14, 15, 16],
  sexta: [9, 10, 11, 14, 15, 16],
  sabado: [9, 10, 11],
};

/** Quantos dias à frente o bot procura horário de visita. */
export const HORIZONTE_VISITA_DIAS = 14;

function fmtData(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Slot no formato "YYYY-MM-DDTHH:mm" (horário local, sem timezone). */
export function montarSlot(d: Date, hora: number): string {
  return `${fmtData(d)}T${String(hora).padStart(2, '0')}:00`;
}

/** Todos os horários possíveis (dentro das janelas) a partir de agora, em ordem. */
export function slotsCandidatos(
  aPartirDeISO: string,
  horizonteDias = HORIZONTE_VISITA_DIAS,
): string[] {
  const base = new Date(aPartirDeISO);
  const out: string[] = [];
  for (let d = 0; d < horizonteDias; d++) {
    const dia = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
    const nome = DOW[dia.getDay()];
    const horas = nome ? JANELAS_VISITA[nome] : undefined;
    if (!horas) continue;
    for (const h of horas) {
      const slot = montarSlot(dia, h);
      if (new Date(slot) > base) out.push(slot);
    }
  }
  return out;
}

/** Mantém só os slots que casam com a preferência (dia e/ou período) da noiva. */
export function filtrarPreferencia(slots: string[], pref?: PreferenciaVisita): string[] {
  if (!pref || pref.indiferente) return slots;
  return slots.filter((s) => {
    const dt = new Date(s);
    if (pref.diaSemana && DOW[dt.getDay()] !== pref.diaSemana) return false;
    if (pref.periodo) {
      const manha = dt.getHours() < 12;
      if (pref.periodo === 'manha' && !manha) return false;
      if (pref.periodo === 'tarde' && manha) return false;
    }
    return true;
  });
}

/** Texto amigável do horário: "quinta-feira (07/08) às 14h". */
export function descreverSlot(slotISO: string): string {
  const dt = new Date(slotISO);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${DOW_LABEL[dt.getDay()]} (${dd}/${mm}) às ${dt.getHours()}h`;
}
