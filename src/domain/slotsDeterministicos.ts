// Piso determinístico da leitura da mensagem. O LLM (NLU) é não determinístico
// mesmo em temperatura 0: com a mesma frase ("queria para 2028... prefiro um
// sábado... cerca de 200 convidados") ele às vezes devolve tudo e às vezes só o
// ano, e o bot então pergunta de novo o que a pessoa acabou de dizer. Aqui o que
// o texto diz de forma INEQUÍVOCA é extraído por regra e completa o que o LLM
// deixou vazio. O LLM sempre vence quando preencheu o campo.

import type { Ano, DiaSemana, EstadoConversa, Slots } from './types';

const ESTADOS_DE_VISITA: EstadoConversa[] = ['aguardando_pref_visita', 'visita_tecnica_data'];
// Onde a pessoa está dizendo quando é o evento (um dia da semana citado aqui é o dia do evento).
const ESTADOS_DE_QUALIFICACAO: EstadoConversa[] = ['novo', 'aguardando_assunto', 'aguardando_qualificacao'];

const DIAS: [RegExp, DiaSemana][] = [
  [/(?<![a-zà-ú])s[áa]bado(?![a-zà-ú])/, 'sabado'],
  [/(?<![a-zà-ú])domingo(?![a-zà-ú])/, 'domingo'],
  [/(?<![a-zà-ú])segunda(-feira)?(?![a-zà-ú])/, 'segunda'],
  [/(?<![a-zà-ú])ter[çc]a(-feira)?(?![a-zà-ú])/, 'terca'],
  [/(?<![a-zà-ú])quarta(-feira)?(?![a-zà-ú])/, 'quarta'],
  [/(?<![a-zà-ú])quinta(-feira)?(?![a-zà-ú])/, 'quinta'],
  [/(?<![a-zà-ú])sexta(-feira)?(?![a-zà-ú])/, 'sexta'],
];

function diaDaSemana(t: string): Pick<Slots, 'diaSemana' | 'preferenciaDia'> {
  const citados = DIAS.filter(([re]) => re.test(t)).map(([, d]) => d);
  if (citados.length === 1) return { diaSemana: citados[0] };
  // "sábado ou domingo": não é um dia só, mas é claramente fim de semana.
  if (citados.length > 1 && citados.every((d) => d === 'sabado' || d === 'domingo')) {
    return { preferenciaDia: 'fim_de_semana' };
  }
  if (/(?<![a-zà-ú])(fim|final) de semana(?![a-zà-ú])/.test(t)) return { preferenciaDia: 'fim_de_semana' };
  if (/(?<![a-zà-ú])(dia de semana|durante a semana|meio de semana)(?![a-zà-ú])/.test(t)) {
    return { preferenciaDia: 'dia_de_semana' };
  }
  return {};
}

const FAIXA_CONVIDADOS = (n: number): boolean => n >= 10 && n <= 5000;

const MESES = 'janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
// "100, 150", "de 100 a 150", "entre 120 e 150", "80 ou 90". Nunca data ("15 e 16 de março", "dia 15 ou 20"),
// hora ("10 às 12h") nem ano ("2028 ou 2029").
const RE_FAIXA = new RegExp(
  `(?<![\\d/:.])(\\d{2,4})\\s*(?:,|\\s+a|\\s+à|\\s+até|\\s+ou|\\s+e|\\s*-)\\s*(\\d{2,4})(?![\\d/:]|\\s*(?:h|hs|horas|anos|dias|meses|%|de\\s+(?:${MESES})))`,
  'g',
);

/**
 * Faixa de convidados ("100, 150, algo assim"): vale o maior, que é o que decide a proposta (mini wedding
 * é até 80 e o limite sentado é 240). O LLM às vezes não lê a faixa e o bot perguntava de novo o que a
 * pessoa já tinha dito (teste da Raquel, 16/10).
 */
function faixaDeConvidados(t: string): number | undefined {
  for (const m of t.matchAll(RE_FAIXA)) {
    const antes = t.slice(Math.max(0, (m.index ?? 0) - 6), m.index ?? 0);
    if (/(?<![a-zà-ú])(dia|dias|às|as)\s*$/.test(antes)) continue;
    const [a, b] = [Number(m[1]), Number(m[2])];
    const ehAno = (n: number) => n >= 2026 && n <= 2035;
    if (ehAno(a) || ehAno(b) || !FAIXA_CONVIDADOS(a) || !FAIXA_CONVIDADOS(b)) continue;
    return Math.max(a, b);
  }
  return undefined;
}

function convidados(t: string, qualificando: boolean): number | undefined {
  const m = t.match(/(\d{1,4})\s*(?:convidados|pessoas|adultos)(?![a-zà-ú])/);
  if (m) {
    // Mesma faixa da NLU: abaixo de 10 não é um evento de casamento, acima de 5000 é exagero.
    const n = Number(m[1]);
    return FAIXA_CONVIDADOS(n) ? n : undefined;
  }
  if (!qualificando) return undefined;
  const faixa = faixaDeConvidados(t);
  if (faixa !== undefined) return faixa;
  // "uns 40", "cerca de 120": aproximação sem a palavra "pessoas". Só enquanto ela diz o
  // tamanho do evento, e nunca um ano, hora ou data.
  const aprox = t.match(
    /(?<![a-zà-ú])(?:uns|umas|cerca de|aproximadamente|mais ou menos|em torno de|por volta de)\s*(\d{2,4})(?![\d/:]|\s*(?:h|hs|horas|anos|dias|meses|%))/,
  );
  const n = aprox ? Number(aprox[1]) : NaN;
  return FAIXA_CONVIDADOS(n) && !(n >= 2026 && n <= 2035) ? n : undefined;
}

function ano(t: string): Ano | undefined {
  const anos = new Set(t.match(/(?<!\d)(2027|2028)(?!\d)/g));
  if (anos.size !== 1) return undefined;
  return Number([...anos][0]) as Ano;
}

/** Completa `slots` (lidos pelo LLM) com o que o texto diz sem ambiguidade. */
export function completarSlots(texto: string, estado: EstadoConversa, slots: Slots): Slots {
  if (ESTADOS_DE_VISITA.includes(estado)) return slots;
  const t = texto.toLowerCase();
  const saida: Slots = { ...slots };

  saida.convidados ??= convidados(t, ESTADOS_DE_QUALIFICACAO.includes(estado));
  saida.ano ??= ano(t);
  // Dia da semana só onde a pessoa está falando do dia do EVENTO, e só se o LLM
  // não deu nem o dia nem a preferência.
  if (ESTADOS_DE_QUALIFICACAO.includes(estado) && !saida.diaSemana && !saida.preferenciaDia) {
    Object.assign(saida, diaDaSemana(t));
  }
  // `??=` deixa chaves com undefined: limpa para o objeto ficar igual ao do LLM.
  for (const k of Object.keys(saida) as (keyof Slots)[]) if (saida[k] === undefined) delete saida[k];
  return saida;
}
