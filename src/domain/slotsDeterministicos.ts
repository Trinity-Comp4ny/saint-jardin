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

function convidados(t: string): number | undefined {
  const m = t.match(/(\d{1,4})\s*(?:convidados|pessoas|adultos)(?![a-zà-ú])/);
  if (!m) return undefined;
  const n = Number(m[1]);
  // Mesma faixa da NLU: abaixo de 10 não é um evento de casamento, acima de 5000 é exagero.
  return n >= 10 && n <= 5000 ? n : undefined;
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

  saida.convidados ??= convidados(t);
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
