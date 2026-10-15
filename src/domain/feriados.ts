// Feriados nacionais do Brasil, calculados no código (sem API, sem rede, vale para
// qualquer ano). Existe por uma regra obrigatória do negócio: mini wedding NÃO vale
// em feriado nem na véspera de feriado (segunda a quinta-feira, "exceto feriados
// ou vésperas"). Os testes comparam o resultado com a BrasilAPI (2026 a 2035).
//
// Entram os feriados nacionais mais Carnaval (segunda e terça), Sexta-feira Santa e
// Corpus Christi. Carnaval e Corpus Christi são "ponto facultativo" por lei, mas na
// prática o mercado de eventos os trata como feriado, e a BrasilAPI também os lista.

/**
 * Feriados locais (estaduais e municipais) que também bloqueiam o mini wedding.
 * DECIDIDO (15/10/2026): só nacionais. O espaço fica em Sorocaba/Araçoiaba da Serra (SP), e os
 * feriados municipais e estaduais não entram. A lista existe para o caso de isso mudar.
 */
export const FERIADOS_LOCAIS: readonly string[] = [
  // Formato "MM-DD", recorrente todo ano. Ex.: '07-09' (revolução de 1932, SP).
];

/** Feriados de data fixa, "MM-DD". */
const FIXOS: readonly string[] = [
  '01-01', // Confraternização Universal
  '04-21', // Tiradentes
  '05-01', // Dia do Trabalho
  '09-07', // Independência
  '10-12', // Nossa Senhora Aparecida
  '11-02', // Finados
  '11-15', // Proclamação da República
  '11-20', // Consciência Negra
  '12-25', // Natal
];

const DIA_MS = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC ao meio-dia. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia, 12));
}

const cache = new Map<number, Set<string>>();

/** Datas ISO (YYYY-MM-DD) dos feriados do ano: fixos, móveis (Páscoa) e locais. */
export function feriadosDoAno(ano: number): Set<string> {
  const pronto = cache.get(ano);
  if (pronto) return pronto;
  const p = pascoa(ano).getTime();
  const datas = new Set<string>();
  for (const md of [...FIXOS, ...FERIADOS_LOCAIS]) datas.add(`${ano}-${md}`);
  for (const offset of [-48, -47, -2, 0, 60]) datas.add(iso(new Date(p + offset * DIA_MS)));
  cache.set(ano, datas);
  return datas;
}

function somaDias(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.split('-').map(Number);
  return iso(new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1, 12) + dias * DIA_MS));
}

/** A data (YYYY-MM-DD) é feriado ou véspera de feriado? */
export function ehFeriadoOuVespera(dataISO: string): boolean {
  const dia = dataISO.slice(0, 10);
  const ano = Number(dia.slice(0, 4));
  if (!Number.isInteger(ano)) return false;
  if (feriadosDoAno(ano).has(dia)) return true;
  // A véspera de 1º de janeiro cai no ano anterior, e a de 31/12 no seguinte: olha o dia seguinte.
  const amanha = somaDias(dia, 1);
  return feriadosDoAno(Number(amanha.slice(0, 4))).has(amanha);
}

/**
 * Só dia e mês ("MM-DD"), sem ano: dá para checar os feriados de data fixa (e locais),
 * os móveis dependem do ano. Usado quando a noiva diz "7 de setembro" e ainda não o ano.
 */
export function ehFeriadoFixoOuVespera(mesDia: string): boolean {
  const fixos = new Set([...FIXOS, ...FERIADOS_LOCAIS]);
  if (fixos.has(mesDia)) return true;
  // Véspera: usa um ano qualquer bissexto e não bissexto não importa, o dia seguinte de MM-DD é o mesmo.
  const amanha = somaDias(`2028-${mesDia}`, 1).slice(5);
  return fixos.has(amanha);
}
