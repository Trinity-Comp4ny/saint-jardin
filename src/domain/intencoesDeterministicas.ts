// Rede determinística da leitura da mensagem. O LLM (NLU) erra de formas previsíveis e
// de forma não determinística, mesmo em temperatura 0. O que o texto diz sem ambiguidade
// corrige a leitura aqui, e o modelo nunca é a única barreira de regras que importam
// (cliente fechada, evento que não é casamento, problema com o PDF).

import type { EntradaNLU, EstadoConversa, PreferenciaVisita, Slots } from './types';
import { ehSaudacaoPura } from './texto';
import { diaDaSemanaNoTexto, horaNoTexto, rotuloDiaSemana } from './visita';

const ESTADOS_COMERCIAIS: EstadoConversa[] = ['novo', 'aguardando_assunto', 'aguardando_qualificacao'];
const ESTADOS_DE_VISITA: EstadoConversa[] = ['aguardando_pref_visita', 'visita_tecnica_data'];

const L = '(?<![a-zà-ú])';
const R = '(?![a-zà-ú])';

// "vou pensar", "vou ver com meu noivo", "preciso conversar", "deixa eu ver".
const RE_INDECISO = new RegExp(
  `${L}(vou (pensar|ver com|conversar|falar com|consultar|olhar com)|preciso (ver|conversar|falar|pensar)|vamos (pensar|ver|conversar)|deixa eu (ver|pensar|conversar))${R}`,
);

// Coisas que SÓ quem já contratou diz: "meu contrato", "minha parcela", "fechei com vocês".
const RE_CLIENTE_FECHADO = new RegExp(
  `${L}((meu|minha|nosso|nossa)\\s+(contrato|pagamento|parcelas?|boleto|entrada)|j[áa]\\s+(sou|somos)\\s+clientes?|(fechei|fechamos|contratei|contratamos)\\s+com\\s+(voc[êe]s|o\\s+saint))${R}`,
);

const RE_NAO_CASAMENTO = new RegExp(
  `${L}(corporativ\\w*|empresa|empresarial|confraterniza\\w*|anivers[áa]rio|15 anos|quinze anos|debutante|formatura|batizado|ch[áa] (de|bar)|palestra|workshop|treinamento|conven[çc][ãa]o)${R}`,
);
const RE_CASAMENTO = new RegExp(`${L}(casamento|casar|casaremos|noiv\\w*|wedding|mini wedding)${R}`);

const RE_PRECO = new RegExp(
  `${L}(valor(es)?|pre[çc]os?|quanto (custa|[ée]|fica|sai|cobram)|or[çc]amento|or[çc]ar|cota[çc][ãa]o|cotar|tabela)${R}`,
);

// Despedida cordial depois da proposta: "obrigada, vou olhar com calma", "depois eu volto".
// O modelo oscila entre despedida e "seguir_fluxo" para a mesma frase.
const RE_DESPEDIDA = new RegExp(
  `${L}(vou (olhar|analisar|ver|pensar)( isso)? com calma|obrigad[oa][^?]*(vou (olhar|ver|pensar|analisar)|depois (eu )?(volto|falo|retorno|vejo))|qualquer coisa (eu )?(te )?(chamo|falo|aviso|retorno)|depois (eu )?(te )?(falo|aviso|retorno|volto))${R}`,
);

// "não consegui abrir o pdf", "o vídeo não carrega", "manda o valor aqui no texto".
const RE_PROBLEMA_ARQUIVO = new RegExp(
  `${L}(n[ãa]o (consegui|consigo|abre|abriu|chegou|carrega|carregou|baixou|baixa)|(pdf|arquivo|v[ií]deo|anexo)[^.?!]{0,40}(n[ãa]o|erro|problema|corrompid)|(manda|mande|envia|envie|passa|passe)r? (o )?(valor|valores|pre[çc]o)s? (aqui|no texto|por texto|em texto|escrito)|(valor|valores|pre[çc]os?) (aqui )?(no|em|por) texto)`,
);

// "Visita técnica" é termo do processo da Raquel (fornecedor de casamento já fechado). O modelo
// alterna entre "fornecedor" e "visita_tecnica" para a mesma frase, e a regra de terça a sexta
// com 30 dias só vale se cair no fluxo certo.
const RE_VISITA_TECNICA = /visita\s+t[ée]cnica/;

// Ano que o bot não vende (2026, 2029 em diante), citado com dados de orçamento: é uma
// resposta à pergunta de data, não uma dúvida fora do roteiro. O bot pede 2027 ou 2028.
const RE_ANO_QUALQUER = /(?<!\d)20[2-4]\d(?!\d)/;

// 2029 em diante: a agenda ainda não abriu. 2029 abre em janeiro de 2027 (texto da Raquel).
const RE_ANO_FUTURO = /(?<!\d)(20[2-4]\d)(?!\d)/g;
const RE_ANO_VENDAVEL = /(?<!\d)202[78](?!\d)/;

/** Primeiro ano de 2029 a 2049 citado, se o texto não cita também 2027 ou 2028. */
function anoAindaFechado(texto: string): number | undefined {
  if (RE_ANO_VENDAVEL.test(texto)) return undefined;
  for (const m of texto.matchAll(RE_ANO_FUTURO)) {
    const ano = Number(m[1]);
    if (ano >= 2029) return ano;
  }
  return undefined;
}

/** Corrige a leitura do modelo com o que o texto diz de forma inequívoca. */
export function ajustarEntrada(texto: string, estado: EstadoConversa, entrada: EntradaNLU): EntradaNLU {
  if (ESTADOS_DE_VISITA.includes(estado)) {
    return estado === 'aguardando_pref_visita' ? { ...entrada, visita: completarVisita(texto, entrada.visita) } : entrada;
  }
  const t = texto.toLowerCase();
  const e: EntradaNLU = { ...entrada };
  const comercial = ESTADOS_COMERCIAIS.includes(estado);
  // Pergunta de preço na oferta do mini também é pedir informação (o PDF do mini responde).
  const falaDePreco = comercial || estado === 'aguardando_interesse_mini';
  const naoCasamento = RE_NAO_CASAMENTO.test(t) && !RE_CASAMENTO.test(t);

  // Só um cumprimento ("tudo bem?") enquanto o bot espera o assunto não inicia o fluxo: o modelo
  // às vezes lê "tudo bem?" como pedido e o bot mandava abertura e vídeo para quem só cumprimentou.
  if (
    (estado === 'novo' || estado === 'aguardando_assunto') &&
    e.intencao === 'seguir_fluxo' &&
    ehSaudacaoPura(t)
  ) {
    e.intencao = 'saudacao';
  }

  if (RE_INDECISO.test(t) && !e.afirmativo) e.indeciso = true;

  if (RE_VISITA_TECNICA.test(t) && ['fornecedor', 'seguir_fluxo', 'fora_do_script', 'agendar_visita'].includes(e.intencao)) {
    e.intencao = 'visita_tecnica';
  }
  if (e.intencao === 'visita_tecnica') return separarDatasDaVisitaTecnica(texto, e);

  // Ano que ainda não vendemos. 2029: o bot avisa e usa 2028 como base (ver `anoIndisponivel` na
  // máquina de estados). 2030 em diante: a Raquel não definiu, então vai para ela, em silêncio.
  const anoFechado = anoAindaFechado(t);
  if (anoFechado === 2029) {
    e.anoIndisponivel = 2029;
    if (e.intencao === 'fora_do_script') e.intencao = 'seguir_fluxo';
  } else if (anoFechado !== undefined && ['seguir_fluxo', 'agendar_visita'].includes(e.intencao)) {
    e.intencao = 'fora_do_script';
  }
  // Ano fechado (2029+) já foi tratado acima: esta regra é só para os demais (ex.: 2026), senão
  // ela desfazia o encaminhamento de 2030 em diante para a Raquel.
  if (
    comercial &&
    anoFechado === undefined &&
    e.intencao === 'fora_do_script' &&
    RE_ANO_QUALQUER.test(t) &&
    (e.slots.convidados !== undefined || e.slots.diaSemana !== undefined || e.slots.preferenciaDia !== undefined)
  ) {
    e.intencao = 'seguir_fluxo';
  }

  if (RE_CLIENTE_FECHADO.test(t) && ['seguir_fluxo', 'fora_do_script', 'negociar'].includes(e.intencao)) {
    e.intencao = 'cliente_fechado';
  } else if (comercial && naoCasamento && ['seguir_fluxo', 'agendar_visita'].includes(e.intencao)) {
    // Evento corporativo, aniversário etc.: o fluxo e o vídeo são de casamento.
    e.intencao = 'fora_do_script';
  } else if (falaDePreco && e.intencao === 'fora_do_script' && !naoCasamento && RE_PRECO.test(t)) {
    // Perguntar valor/preço é pedir orçamento, não uma dúvida fora do script.
    e.intencao = 'seguir_fluxo';
  } else if (RE_PROBLEMA_ARQUIVO.test(t) && e.intencao === 'seguir_fluxo') {
    // Problema com o PDF/vídeo ou pedido de valor por texto: precisa de gente, não de silêncio.
    e.intencao = 'fora_do_script';
  }
  // Só depois da proposta: na oferta do mini "vou ver com meu noivo" é indecisão (recebe o PDF),
  // não despedida.
  if (estado === 'proposta_enviada' && e.intencao === 'seguir_fluxo' && RE_DESPEDIDA.test(t) && !t.includes('?')) {
    e.intencao = 'despedida';
  }
  return e;
}

/** Completa dia e horário da visita com o que o texto diz, se o modelo não pegou. */
export function completarVisita(texto: string, visita?: PreferenciaVisita): PreferenciaVisita {
  const v: PreferenciaVisita = { ...(visita ?? {}) };
  const dia = diaDaSemanaNoTexto(texto);
  if (dia && !v.diaSemana) v.diaSemana = dia;
  const hora = horaNoTexto(texto);
  if (hora !== undefined && !v.dataHora) {
    const quando = [v.diaSemana ? rotuloDiaSemana(v.diaSemana) : '', `às ${hora}h`].filter(Boolean).join(' ');
    v.dataHora = quando;
  }
  return v;
}

// Palavras que, logo antes de uma data, mostram que é a data do CASAMENTO que o fornecedor atende.
const RE_PALAVRA_CASAMENTO = /(casamento|casório|evento|festa|cerim[oô]nia|noiv\w+|wedding)/;
const RE_DATA_NUMERICA = /(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?!\d)/g;

interface DataNoTexto {
  /** ISO se tem ano, "MM-DD" se não. */
  valor: string;
  ehCasamento: boolean;
}

function datasNoTexto(texto: string): DataNoTexto[] {
  const t = texto.toLowerCase();
  const achadas: DataNoTexto[] = [];
  for (const m of t.matchAll(RE_DATA_NUMERICA)) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
    const mm = String(mes).padStart(2, '0');
    const dd = String(dia).padStart(2, '0');
    const ano = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
    const antes = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
    achadas.push({
      valor: ano ? `${ano}-${mm}-${dd}` : `${mm}-${dd}`,
      ehCasamento: RE_PALAVRA_CASAMENTO.test(antes) && !/visita/.test(antes),
    });
  }
  return achadas;
}

/** Remove de `slots` o conjunto de data (a data do casamento não é a da visita). */
function tirarDataDosSlots(slots: Slots): Slots {
  const { data: _d, mesDia: _md, mes: _m, dia: _di, ano: _a, ...resto } = slots;
  return resto;
}

/**
 * Visita técnica: o fornecedor cita duas datas, a do casamento que atende e a da visita que
 * quer. O modelo às vezes põe a do casamento no conjunto de data da conversa (que é a da
 * VISITA), e o bot passava a tratar a data do casamento como data da visita. A data que vem
 * depois de "casamento/evento/festa" é a do casamento: sai de `slots` e vai para
 * `casamentoAtendido.data`. Se há uma data de visita no texto, ela fica em `slots`.
 */
export function separarDatasDaVisitaTecnica(texto: string, entrada: EntradaNLU): EntradaNLU {
  const datas = datasNoTexto(texto);
  const casamento = datas.find((d) => d.ehCasamento);
  if (!casamento) return entrada;
  const visita = datas.find((d) => !d.ehCasamento);

  const e: EntradaNLU = {
    ...entrada,
    casamentoAtendido: { ...entrada.casamentoAtendido, data: entrada.casamentoAtendido?.data ?? casamento.valor },
  };
  // Só mexe em `slots` se a data que o modelo colocou lá é a do casamento.
  const slots = entrada.slots;
  const slotsTemOCasamento =
    slots.data === casamento.valor || (!!slots.mesDia && casamento.valor.endsWith(slots.mesDia) && !slots.data);
  if (slotsTemOCasamento) {
    const semData = tirarDataDosSlots(slots);
    if (visita?.valor.length === 10) e.slots = { ...semData, data: visita.valor };
    else if (visita) e.slots = { ...semData, mesDia: visita.valor };
    else e.slots = semData;
  } else if (
    !visita &&
    casamento.valor.length === 10 &&
    slots.ano === Number(casamento.valor.slice(0, 4)) &&
    !slots.data &&
    !slots.mesDia
  ) {
    // O modelo guardou só o ANO do casamento no conjunto de data da visita.
    const { ano: _ano, ...semAno } = slots;
    e.slots = semAno;
  }
  return e;
}
