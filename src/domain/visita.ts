// Regras e utilidades da visita de noiva (ADR-0005 / spec agendamento-visita).
// Puras: geram os horários candidatos a partir das janelas e formatam para humano.
// O adapter (Supabase/Google) só subtrai os horários já ocupados.

import type { DiaSemana, PreferenciaVisita, Slots } from './types';

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

// ── Visita técnica (fornecedor de casamento fechado): regras da Raquel ──────────

/** Antecedência mínima para agendar visita técnica. */
export const ANTECEDENCIA_MINIMA_DIAS = 30;

/** Constrói uma Date local (meia-noite) a partir de "YYYY-MM-DD", sem efeito de timezone. */
function dataLocal(dataISO: string): Date {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/**
 * Data completa da visita técnica a partir dos slots. Só dia/mês (sem ano):
 * escolhe o próximo ano em que a data cai a pelo menos 30 dias à frente.
 */
export function resolverDataTecnica(slots: Slots, hojeISO: string): string | undefined {
  if (slots.data) return slots.data.slice(0, 10);
  if (!slots.mesDia) return undefined;
  if (slots.ano) return `${slots.ano}-${slots.mesDia}`;

  const hoje = new Date(hojeISO);
  const anoBase = hoje.getFullYear();
  const candidata = dataLocal(`${anoBase}-${slots.mesDia}`);
  const hojeLocal = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((candidata.getTime() - hojeLocal.getTime()) / 86_400_000);
  const ano = dias < ANTECEDENCIA_MINIMA_DIAS ? anoBase + 1 : anoBase;
  return `${ano}-${slots.mesDia}`;
}

export type MotivoForaRegra = 'fim_de_semana' | 'antecedencia';

/** Valida a data da visita técnica: terça a sexta E ao menos 30 dias de antecedência. */
export function validarVisitaTecnica(
  dataISO: string,
  hojeISO: string,
): { ok: true } | { ok: false; motivo: MotivoForaRegra } {
  const data = dataLocal(dataISO);
  const dow = data.getDay(); // 0=domingo ... 6=sábado; terça(2) a sexta(5)
  if (dow < 2 || dow > 5) return { ok: false, motivo: 'fim_de_semana' };

  const hoje = new Date(hojeISO);
  const hojeLocal = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = Math.round((data.getTime() - hojeLocal.getTime()) / 86_400_000);
  if (dias < ANTECEDENCIA_MINIMA_DIAS) return { ok: false, motivo: 'antecedencia' };

  return { ok: true };
}

/** Texto amigável de uma data (sem hora): "terça-feira (15/09/2027)". */
export function descreverData(dataISO: string): string {
  const dt = dataLocal(dataISO);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${DOW_LABEL[dt.getDay()]} (${dd}/${mm}/${dt.getFullYear()})`;
}
