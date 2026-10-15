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

// ---------------------------------------------------------------------------
// Horário que o bot anuncia para visita de noiva (texto da Raquel, 14/10/2026):
// "segunda a sexta, em horário comercial, e aos sábados, das 8h às 13h".
// "Horário comercial" não foi definido: assumimos 8h às 18h (CONFIRMAR COM A RAQUEL).
// Pedido fora disso não é recusado: o bot abre uma exceção a ser avaliada pela equipe.
// ---------------------------------------------------------------------------

const HORARIO_SEMANA = { inicio: 8, fim: 18 } as const;
const HORARIO_SABADO = { inicio: 8, fim: 13 } as const;

const NOMES_DIA: [RegExp, DiaSemana][] = [
  [/(?<![a-zà-ú])s[áa]bado(?![a-zà-ú])/, 'sabado'],
  [/(?<![a-zà-ú])domingo(?![a-zà-ú])/, 'domingo'],
  [/(?<![a-zà-ú])segunda(-feira)?(?![a-zà-ú])/, 'segunda'],
  [/(?<![a-zà-ú])ter[çc]a(-feira)?(?![a-zà-ú])/, 'terca'],
  [/(?<![a-zà-ú])quarta(-feira)?(?![a-zà-ú])/, 'quarta'],
  [/(?<![a-zà-ú])quinta(-feira)?(?![a-zà-ú])/, 'quinta'],
  [/(?<![a-zà-ú])sexta(-feira)?(?![a-zà-ú])/, 'sexta'],
];

/** Rótulo para a noiva: "sábado", "segunda-feira"... */
export function rotuloDiaSemana(d: DiaSemana): string {
  return DOW_LABEL[DOW.indexOf(d)] ?? d;
}

/** Dia da semana citado pelo nome no texto (só se for um único). */
export function diaDaSemanaNoTexto(texto: string): DiaSemana | undefined {
  const t = texto.toLowerCase();
  const achados = NOMES_DIA.filter(([re]) => re.test(t)).map(([, d]) => d);
  return achados.length === 1 ? achados[0] : undefined;
}

/** Dia da semana de uma data "dd/mm" ou "dd/mm/aaaa" no texto (sem ano: a próxima ocorrência). */
function diaDaSemanaDaData(texto: string, agoraISO: string): DiaSemana | undefined {
  const m = texto.match(/(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)/);
  if (!m) return undefined;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return undefined;
  const agora = new Date(agoraISO);
  let ano = m[3] ? Number(m[3]) : agora.getFullYear();
  if (m[3] && ano < 100) ano += 2000;
  let data = new Date(ano, mes - 1, dia);
  if (!m[3] && data < new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())) {
    data = new Date(ano + 1, mes - 1, dia);
  }
  return DOW[data.getDay()];
}

/** Hora (0-23) citada no texto: "10h", "16:30", "às 9", "3 da tarde", "meio-dia". */
export function horaNoTexto(texto: string): number | undefined {
  const t = texto.toLowerCase();
  if (/meio[- ]?dia/.test(t)) return 12;
  const explicita = t.match(/(?<!\d)(\d{1,2})\s*(?:h|hs|horas?|:)\s*(\d{2})?(?!\d)/);
  const solta = t.match(/(?:às|as|a partir das)\s*(\d{1,2})(?!\d|\/|:)/);
  const crua = explicita?.[1] ?? solta?.[1];
  if (crua === undefined) return undefined;
  let h = Number(crua);
  if (h > 23) return undefined;
  if (/(da tarde|da noite)/.test(t) && h < 12) h += 12;
  return h;
}

/**
 * O pedido de visita cai fora do horário que o bot anunciou? Devolve como a noiva
 * chamou o pedido ("domingo às 15h"), ou `undefined` se está dentro ou não dá para saber.
 */
export function visitaForaDoHorario(
  v: PreferenciaVisita,
  agoraISO: string,
): { quando: string } | undefined {
  const texto = v.dataHora ?? '';
  const dia = v.diaSemana ?? diaDaSemanaNoTexto(texto) ?? diaDaSemanaDaData(texto, agoraISO);
  let hora = texto ? horaNoTexto(texto) : undefined;
  // Só o período ("de tarde", "de noite"): usa uma hora representativa dentro dele.
  if (hora === undefined && v.periodo) hora = v.periodo === 'manha' ? 9 : 15;
  if (/(da|de|à|a) noite|noitinha/.test(texto.toLowerCase())) hora ??= 19;

  const quando =
    v.dataHora ??
    [dia ? DOW_LABEL[DOW.indexOf(dia)] : '', v.periodo === 'manha' ? 'de manhã' : v.periodo === 'tarde' ? 'de tarde' : '']
      .filter(Boolean)
      .join(' ');

  if (dia === 'domingo') return { quando };
  if (dia === 'sabado') {
    if (hora !== undefined && (hora < HORARIO_SABADO.inicio || hora >= HORARIO_SABADO.fim)) return { quando };
    return undefined;
  }
  // Segunda a sexta, ou dia desconhecido (só barra o que não cabe em nenhum dia).
  if (hora !== undefined && (hora < HORARIO_SEMANA.inicio || hora >= HORARIO_SEMANA.fim)) return { quando };
  return undefined;
}
