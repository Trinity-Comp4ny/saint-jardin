// Rede determinística da leitura da mensagem. O LLM (NLU) erra de formas previsíveis e
// de forma não determinística, mesmo em temperatura 0. O que o texto diz sem ambiguidade
// corrige a leitura aqui, e o modelo nunca é a única barreira de regras que importam
// (cliente fechada, evento que não é casamento, problema com o PDF).

import type { EntradaNLU, EstadoConversa, PreferenciaVisita } from './types';
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

/** Corrige a leitura do modelo com o que o texto diz de forma inequívoca. */
export function ajustarEntrada(texto: string, estado: EstadoConversa, entrada: EntradaNLU): EntradaNLU {
  if (ESTADOS_DE_VISITA.includes(estado)) {
    return estado === 'aguardando_pref_visita' ? { ...entrada, visita: completarVisita(texto, entrada.visita) } : entrada;
  }
  const t = texto.toLowerCase();
  const e: EntradaNLU = { ...entrada };
  const comercial = ESTADOS_COMERCIAIS.includes(estado);
  const naoCasamento = RE_NAO_CASAMENTO.test(t) && !RE_CASAMENTO.test(t);

  if (RE_INDECISO.test(t) && !e.afirmativo) e.indeciso = true;

  if (RE_VISITA_TECNICA.test(t) && ['fornecedor', 'seguir_fluxo', 'fora_do_script', 'agendar_visita'].includes(e.intencao)) {
    e.intencao = 'visita_tecnica';
    return e;
  }
  if (
    comercial &&
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
  } else if (comercial && e.intencao === 'fora_do_script' && !naoCasamento && RE_PRECO.test(t)) {
    // Perguntar valor/preço é pedir orçamento, não uma dúvida fora do script.
    e.intencao = 'seguir_fluxo';
  } else if (RE_PROBLEMA_ARQUIVO.test(t) && e.intencao === 'seguir_fluxo') {
    // Problema com o PDF/vídeo ou pedido de valor por texto: precisa de gente, não de silêncio.
    e.intencao = 'fora_do_script';
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
