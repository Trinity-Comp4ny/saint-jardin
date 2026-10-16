// Máquina de estados determinística da conversa.
// É uma função PURA: mesmas entradas -> mesmas saídas. O LLM fica FORA daqui
// (a leitura da mensagem chega pronta em EntradaNLU), o que torna cada ramo
// testável sem chamar Claude nem WhatsApp.

import {
  DIAS_DE_SEMANA,
  LIMITE_MINI_WEDDING,
  type Ano,
  type Conversa,
  type DiaSemana,
  type EntradaNLU,
  type Intencao,
  type MensagemSaida,
  type PreferenciaDia,
  type Slots,
} from './types';
import { MSG } from './persona';
import { pdfPropostaPorAno } from './pdfs';
import {
  descreverData,
  resolverDataTecnica,
  resumoCasamentoAtendido,
  validarVisitaTecnica,
  visitaForaDoHorario,
} from './visita';
import { ehFeriadoFixoOuVespera, ehFeriadoOuVespera } from './feriados';

export interface DisponibilidadeData {
  data: string;
  livre: boolean;
  alternativa?: string;
}

export interface ContextoDecisao {
  agora: string;
  disponibilidadeData?: DisponibilidadeData;
  /** Semente (derivada da mensagem) para variar frases repetidas sem parecer robô. */
  seed?: number;
}

/** Escolhe uma variante de forma determinística pela semente da mensagem. */
function vary(opcoes: readonly string[], seed = 0): string {
  return opcoes[((seed % opcoes.length) + opcoes.length) % opcoes.length] ?? opcoes[0] ?? '';
}

export interface ResultadoDecisao {
  conversa: Conversa;
  saidas: MensagemSaida[];
}

const texto = (t: string): MensagemSaida => ({ tipo: 'texto', texto: t });
// Texto conversacional (pergunta/convite): a redação pode humanizar. Nunca usar
// para mensagens com preço, proposta ou regra — essas ficam com `texto`.
const pergunta = (t: string): MensagemSaida => ({ tipo: 'texto', texto: t, humanizar: true });

export function novaConversa(telefone: string, agora: string): Conversa {
  return {
    telefone,
    estado: 'novo',
    slots: {},
    criadoEm: agora,
    atualizadoEm: agora,
  };
}

/** Classifica o dia em fim de semana (valor cheio) ou dia de semana (mini). */
/** Classe do dia da semana: segunda a quinta é "dia de semana"; sexta a domingo, valor cheio. */
function classeDoDia(d: DiaSemana): PreferenciaDia {
  return DIAS_DE_SEMANA.includes(d) ? 'dia_de_semana' : 'fim_de_semana';
}

/** Classe do dia do calendário de uma data ISO (YYYY-MM-DD). */
function classeDaData(dataISO: string): PreferenciaDia {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number);
  const dow = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getDay(); // 0=dom ... 6=sáb
  return dow >= 1 && dow <= 4 ? 'dia_de_semana' : 'fim_de_semana';
}

export function classificarDia(slots: Slots): PreferenciaDia | undefined {
  // A data concreta manda: se sabemos o dia do calendário, o dia da semana sai
  // dela. Sem isso, quem dizia "dia de semana" e depois dava uma data de sábado
  // recebia proposta de mini wedding para um sábado (e vice-versa).
  const dataISO = dataCompleta(slots);
  if (dataISO) return classeDaData(dataISO);
  if (slots.diaSemana) return classeDoDia(slots.diaSemana);
  return slots.preferenciaDia;
}

/**
 * Regra de negócio (confirmada com a Raquel): mini wedding é SÓ dia de semana
 * (seg-qui) E até 80 convidados. Fim de semana com poucos convidados, ou dia de
 * semana com mais de 80, vão para o valor normal — não se enquadram no mini.
 */
export function ehMiniWedding(slots: Slots): boolean {
  // Já recusou o mini e aceitou as propostas tradicionais: não oferece de novo.
  if (slots.tradicionalAceito) return false;
  // Regra obrigatória: mini wedding não vale em feriado nem na véspera de feriado.
  // Com a data completa checa o calendário inteiro; só com dia e mês, os de data fixa.
  const dataISO = dataCompleta(slots);
  if (dataISO ? ehFeriadoOuVespera(dataISO) : slots.mesDia && ehFeriadoFixoOuVespera(slots.mesDia)) {
    return false;
  }
  const dia = classificarDia(slots);
  const cabeNoMini =
    slots.convidados !== undefined && slots.convidados <= LIMITE_MINI_WEDDING;
  return dia === 'dia_de_semana' && cabeNoMini;
}

/** Ano vendável (2027/2028) a partir de um número qualquer. */
function anoVendavel(y: number | undefined): Ano | undefined {
  return y === 2027 || y === 2028 ? y : undefined;
}

export function mesclarSlots(atual: Slots, novo: Slots): Slots {
  const trouxeParteDeData =
    novo.data !== undefined ||
    novo.mesDia !== undefined ||
    novo.mes !== undefined ||
    novo.dia !== undefined ||
    novo.ano !== undefined;

  let data = atual.data;
  let mesDia = atual.mesDia;
  let mes = atual.mes;
  let dia = atual.dia;
  let ano = atual.ano;

  if (trouxeParteDeData) {
    // Decompõe o que já se sabia em (dia, mês, ano), para uma correção parcial
    // ("na verdade dia 15", "e para 2028?") substituir SÓ aquela parte. Antes, a
    // data completa antiga continuava mandando no fluxo (dataCompleta preferia
    // `data`), e o bot checava disponibilidade da data velha depois da correção.
    if (mesDia) {
      const [m, d] = mesDia.split('-').map(Number);
      mes ??= m;
      dia ??= d;
    }
    if (data) {
      const [y, m, d] = data.slice(0, 10).split('-').map(Number);
      ano ??= anoVendavel(y);
      mes ??= m;
      dia ??= d;
    }

    if (novo.data !== undefined) {
      // Data completa nova substitui tudo que se sabia de data.
      data = novo.data;
      ano = novo.ano ?? anoVendavel(Number(novo.data.slice(0, 4)));
      mesDia = undefined;
      mes = undefined;
      dia = undefined;
    } else {
      data = undefined; // qualquer parte nova invalida a data completa antiga
      if (novo.mesDia !== undefined) {
        const [m, d] = novo.mesDia.split('-').map(Number);
        mes = m;
        dia = d;
      }
      if (novo.mes !== undefined) mes = novo.mes;
      if (novo.dia !== undefined) dia = novo.dia;
      if (novo.ano !== undefined) ano = novo.ano;
      // Recombina no MM-DD canônico (mês e dia podem ter vindo em turnos diferentes).
      mesDia =
        mes && dia
          ? `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
          : undefined;
    }
  }

  let diaSemana = novo.diaSemana ?? atual.diaSemana;
  let preferenciaDia = novo.preferenciaDia ?? atual.preferenciaDia;

  // Um dia da semana ou uma preferência NOVOS que contradizem o que ficou de antes
  // substituem o antigo. Sem isso, "não, prefiro sábado" (o modelo às vezes devolve só
  // a preferência "fim de semana") deixava a "quarta" antiga mandando na classificação
  // e o bot seguia oferecendo mini wedding para quem acabou de pedir sábado.
  const classeNova: PreferenciaDia | undefined = novo.diaSemana
    ? classeDoDia(novo.diaSemana)
    : novo.preferenciaDia;
  if (classeNova) {
    if (!novo.diaSemana && diaSemana && classeDoDia(diaSemana) !== classeNova) diaSemana = undefined;
    // O dia da semana novo é mais específico que a preferência genérica antiga.
    if (novo.diaSemana && !novo.preferenciaDia) preferenciaDia = undefined;
    // Uma data completa antiga que cai na outra classe também fica velha (ano é mantido).
    if (!trouxeParteDeData && data && classeDaData(data) !== classeNova) {
      data = undefined;
      mesDia = undefined;
      mes = undefined;
      dia = undefined;
    }
  }

  return {
    data,
    mesDia,
    mes,
    dia,
    ano,
    diaSemana,
    preferenciaDia,
    convidados: novo.convidados ?? atual.convidados,
    nome: novo.nome ?? atual.nome,
    // Controle interno do aviso de data ocupada: só o próprio bot escreve aqui.
    dataOcupadaAvisada: novo.dataOcupadaAvisada ?? atual.dataOcupadaAvisada,
    tradicionalAceito: novo.tradicionalAceito ?? atual.tradicionalAceito,
    // Visita técnica: campos próprios, nunca misturados com a data do evento de orçamento.
    dataVisitaTecnica: novo.dataVisitaTecnica ?? atual.dataVisitaTecnica,
    dataCasamento: novo.dataCasamento ?? atual.dataCasamento,
    casamentoNoivos: novo.casamentoNoivos ?? atual.casamentoNoivos,
    fornecedorServico: novo.fornecedorServico ?? atual.fornecedorServico,
    anoSolicitado: novo.anoSolicitado ?? atual.anoSolicitado,
  };
}

const MESES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
] as const;

const DIA_SEMANA_LABEL: Record<string, string> = {
  segunda: 'segunda-feira',
  terca: 'terça-feira',
  quarta: 'quarta-feira',
  quinta: 'quinta-feira',
  sexta: 'sexta-feira',
  sabado: 'sábado',
  domingo: 'domingo',
};

/** Descreve, para humano, o "quando" que já se sabe do evento (o mais preciso possível). */
function descreverQuando(slots: Slots): string {
  if (slots.data) {
    const [y, m, d] = slots.data.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }
  if (slots.mesDia) {
    const [m, d] = slots.mesDia.split('-');
    return slots.ano ? `${d}/${m}/${slots.ano}` : `${d}/${m} (ano a definir)`;
  }
  if (slots.mes) {
    const nome = MESES_PT[slots.mes - 1] ?? `mês ${slots.mes}`;
    return slots.ano ? `${nome} de ${slots.ano}` : `${nome} (ano a definir)`;
  }
  if (slots.ano) return `${slots.ano}`;
  if (slots.dia) return `dia ${slots.dia} (mês/ano a definir)`;
  return '';
}

/**
 * Resumo do evento a partir dos slots, para o alerta da Raquel (Telegram): data/ano,
 * dia da semana (ou preferência) e convidados. Vazio se nada foi coletado.
 */
export function resumoEvento(slots: Slots): string {
  const partes: string[] = [];
  const quando = descreverQuando(slots);
  if (quando) partes.push(quando);
  const dia = slots.diaSemana
    ? DIA_SEMANA_LABEL[slots.diaSemana]
    : slots.preferenciaDia === 'fim_de_semana'
      ? 'fim de semana'
      : slots.preferenciaDia === 'dia_de_semana'
        ? 'dia de semana'
        : undefined;
  if (dia) partes.push(dia);
  if (slots.convidados !== undefined) partes.push(`${slots.convidados} convidados`);
  // Pediu um ano que a agenda ainda não abriu: a Raquel vê o que ela queria de fato.
  if (slots.anoSolicitado !== undefined) partes.push(`pediu ${slots.anoSolicitado} (recebeu os valores de 2028)`);
  return partes.join(' · ');
}

/** Ano do evento, seja informado direto ou deduzido de uma data completa. */
export function anoEfetivo(slots: Slots): Ano | undefined {
  if (slots.ano) return slots.ano;
  if (slots.data) {
    const a = Number(slots.data.slice(0, 4));
    if (a === 2027 || a === 2028) return a;
  }
  return undefined;
}

/**
 * Confirma que ano/mês/dia formam uma data de calendário real — rejeita "30
 * de fevereiro" etc. O `new Date(ano, mes, dia)` do JS "rola" datas inválidas
 * pro mês seguinte em vez de reclamar (30/02 vira 02/03); comparar os campos
 * de volta detecta esse rollover.
 */
function dataDeCalendarioValida(iso: string): boolean {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return false;
  const data = new Date(y, m - 1, d);
  return data.getFullYear() === y && data.getMonth() === m - 1 && data.getDate() === d;
}

/**
 * Data ISO completa: a data explícita, ou dia/mês combinado com o ano já
 * sabido. Uma data que não existe no calendário (dia/mês vindos de mensagens
 * separadas podem combinar em algo impossível, tipo dia 30 + fevereiro)
 * degrada pra "sem data completa" — o fluxo segue com o ano que já tem, em
 * vez de checar disponibilidade pra uma data inventada sem avisar ninguém.
 */
export function dataCompleta(slots: Slots): string | undefined {
  if (slots.data) return dataDeCalendarioValida(slots.data) ? slots.data : undefined;
  if (slots.mesDia && slots.ano) {
    const iso = `${slots.ano}-${slots.mesDia}`;
    return dataDeCalendarioValida(iso) ? iso : undefined;
  }
  return undefined;
}

/** A data completa (YYYY-MM-DD) é anterior a hoje? */
export function dataNoPassado(dataISO: string, agoraISO: string): boolean {
  const [y, m, d] = dataISO.slice(0, 10).split('-').map(Number);
  const data = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const hoje = new Date(agoraISO);
  const hojeLocal = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return data.getTime() < hojeLocal.getTime();
}

function motivoDaIntencao(intencao: EntradaNLU['intencao']): string | null {
  switch (intencao) {
    case 'cliente_fechado':
      return 'cliente que já fechou';
    case 'negociar':
      return 'quer negociar valor ou condição';
    case 'fora_do_script':
      return 'pergunta fora do script';
    case 'fornecedor':
      return 'fornecedor/parceria (não é noiva)';
    default:
      return null;
  }
}

/** Os slots acumulados já têm ALGUM dado de orçamento (qualquer parte de data, dia ou convidados). */
function temDadoDeOrcamento(slots: Slots): boolean {
  return (
    slots.data !== undefined ||
    slots.mesDia !== undefined ||
    slots.dia !== undefined ||
    slots.mes !== undefined ||
    slots.ano !== undefined ||
    classificarDia(slots) !== undefined ||
    slots.convidados !== undefined
  );
}

/**
 * A leitura traz um dado de orçamento DIFERENTE do que já se sabe. O modelo às vezes
 * reemite os "dados já coletados" junto de uma frase que não tem nada a ver
 * ("quero conhecer o espaço"), e isso virava uma nova cotação com o mesmo PDF.
 */
function trouxeDadoDiferente(atual: Slots, nlu: EntradaNLU): boolean {
  const novo = nlu.slots;
  return (Object.keys(novo) as (keyof Slots)[]).some(
    (k) => k !== 'nome' && k !== 'anoSolicitado' && novo[k] !== undefined && novo[k] !== atual[k],
  );
}

/** A leitura traz um dado de orçamento novo (data, dia da semana, convidados...). */
function trouxeDadoDeOrcamento(nlu: EntradaNLU): boolean {
  const s = nlu.slots;
  return (
    s.data !== undefined ||
    s.mesDia !== undefined ||
    s.dia !== undefined ||
    s.mes !== undefined ||
    s.ano !== undefined ||
    s.diaSemana !== undefined ||
    s.preferenciaDia !== undefined ||
    s.convidados !== undefined
  );
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY", para mensagens ao cliente (nunca ISO cru). */
function dataBR(dataISO: string): string {
  const [y, m, d] = dataISO.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Marca a proposta como enviada agora. É o ponto de partida do follow-up de 12h
 * (uma proposta nova, por ex. de outro ano, reinicia a contagem).
 */
function propostaEnviada(base: Conversa): Conversa {
  return {
    ...base,
    estado: 'proposta_enviada',
    propostaEnviadaEm: base.atualizadoEm,
    followupEnviadoEm: undefined,
  };
}

/**
 * Proposta normal do ano: mensagem de ano + PDF + convite de visita (texto da Raquel,
 * 15/10/2026). O follow-up de 12h repete o convite se a pessoa não responder.
 */
function enviarPropostaNormal(base: Conversa, ano: Ano): ResultadoDecisao {
  return {
    conversa: propostaEnviada(base),
    saidas: [
      texto(MSG.propostaAno(ano)),
      { tipo: 'pdf', pdf: pdfPropostaPorAno(ano) },
      texto(MSG.conviteVisitaPosProposta),
    ],
  };
}

/**
 * Abertura do atendimento comercial: mensagem da Raquel + vídeo de apresentação.
 * `jaCumprimentou`: o bot já disse "Olá, tudo bem?" na mensagem anterior (o "como
 * posso ajudar"), então a abertura vai sem a saudação, para não repeti-la.
 */
function abertura(jaCumprimentou = false): MensagemSaida[] {
  return [
    texto(jaCumprimentou ? MSG.aberturaSemSaudacao : MSG.abertura),
    { tipo: 'video', video: 'apresentacao' },
  ];
}

type ChecagemDisponibilidade =
  | { bloqueio: ResultadoDecisao } // a resposta deste turno já está decidida
  | { slots: Slots }; // liberado (com a alternativa adotada, quando aceita)

/**
 * Trata a data completa OCUPADA (compartilhado entre proposta normal e mini):
 * 1º turno avisa e oferece a alternativa do calendário (marcando o aviso nos
 * slots); no turno seguinte, um "pode ser" adota a alternativa e um "não" limpa
 * a data e pergunta outra. Sem o aviso prévio, afirmativo/negativo soltos não
 * mexem em data nenhuma (um "sim" pra oferta de mini não pode adotar data).
 */
function checarDisponibilidade(
  base: Conversa,
  slots: Slots,
  nlu: EntradaNLU,
  ctx: ContextoDecisao,
): ChecagemDisponibilidade {
  const dataISO = dataCompleta(slots);
  const disp = ctx.disponibilidadeData;
  if (!dataISO || !disp || disp.data !== dataISO || disp.livre) return { slots };

  // Alternativa real: o calendário pode devolver a própria data quando não acha
  // nada livre à frente — nesse caso não há o que oferecer.
  const alternativa =
    disp.alternativa && disp.alternativa !== dataISO ? disp.alternativa : undefined;
  const jaAvisada = slots.dataOcupadaAvisada === dataISO;

  if (jaAvisada && alternativa && nlu.afirmativo) {
    // Aceitou a alternativa oferecida: adota como a data do evento.
    return {
      slots: {
        ...slots,
        data: alternativa,
        mesDia: undefined,
        mes: undefined,
        dia: undefined,
        ano: anoVendavel(Number(alternativa.slice(0, 4))) ?? anoEfetivo(slots),
        dataOcupadaAvisada: undefined,
      },
    };
  }

  if (jaAvisada && nlu.negativo) {
    // Recusou a alternativa: solta a data ocupada e pergunta outra.
    const slotsSemData: Slots = {
      ...slots,
      data: undefined,
      mesDia: undefined,
      mes: undefined,
      dia: undefined,
      ano: anoEfetivo(slots),
      dataOcupadaAvisada: undefined,
    };
    return {
      bloqueio: {
        conversa: { ...base, slots: slotsSemData },
        saidas: [pergunta(vary(MSG.perguntaData, ctx.seed))],
      },
    };
  }

  return {
    bloqueio: {
      conversa: { ...base, slots: { ...slots, dataOcupadaAvisada: dataISO } },
      saidas: [
        texto(
          alternativa
            ? MSG.dataIndisponivel(dataBR(dataISO), descreverData(alternativa))
            : MSG.dataIndisponivelSemAlternativa(dataBR(dataISO)),
        ),
      ],
    },
  };
}

/**
 * Evento de valor normal com dia e convidados já sabidos: cuida da data.
 * Pergunta a data específica; se vier só dia/mês, pergunta o ano; com o ano
 * definido (direto ou pela data completa), checa disponibilidade e envia a proposta.
 */
function avancarComData(
  base: Conversa,
  slots: Slots,
  nlu: EntradaNLU,
  ctx: ContextoDecisao,
): ResultadoDecisao {
  // Data específica já no passado (mesmo antes de saber o ano vendável): avisa
  // e pede uma data futura.
  const dataISO = dataCompleta(slots);
  if (dataISO && dataNoPassado(dataISO, ctx.agora)) {
    return { conversa: base, saidas: [pergunta(vary(MSG.dataNoPassado, ctx.seed))] };
  }

  const ano = anoEfetivo(slots);
  if (!ano) {
    // Só veio o mês (ex.: "outubro"): pergunta o dia daquele mês, em vez de
    // repetir a pergunta genérica de data.
    if (slots.mes && !slots.dia && !slots.mesDia) {
      return { conversa: base, saidas: [pergunta(MSG.perguntaDiaDoMes(slots.mes))] };
    }
    // Sem ano ainda: se já temos o dia/mês, falta só o ano; senão, pedimos a data.
    const opcoes = slots.mesDia ? MSG.perguntaAno : MSG.perguntaData;
    return { conversa: base, saidas: [pergunta(vary(opcoes, ctx.seed))] };
  }

  // Data completa em jogo e ocupada: avisa/adota/limpa (fluxo completo).
  const checagem = checarDisponibilidade(base, slots, nlu, ctx);
  if ('bloqueio' in checagem) return checagem.bloqueio;
  const slotsFinais = checagem.slots;

  // A alternativa adotada pode cair em outro ano.
  return enviarPropostaNormal(
    { ...base, slots: slotsFinais },
    anoEfetivo(slotsFinais) ?? ano,
  );
}

/** Texto curto da preferência de visita da noiva, para anexar ao motivo do handoff. */
function prefVisitaTexto(nlu: EntradaNLU): string {
  const v = nlu.visita;
  if (!v) return '';
  if (v.indiferente) return ' (tanto faz)';
  const partes: string[] = [];
  if (v.diaSemana) partes.push(v.diaSemana);
  if (v.periodo) partes.push(v.periodo === 'manha' ? 'de manhã' : 'de tarde');
  return partes.length ? ` (${partes.join(' ')})` : '';
}

/**
 * Visita técnica (fornecedor): o bot valida a data (terça a sexta, ≥30 dias) e
 * repassa para a Raquel. Não marca. Sem data válida, orienta e segue coletando.
 */
function fluxoVisitaTecnica(
  base: Conversa,
  slotsData: Slots,
  nlu: EntradaNLU,
  ctx: ContextoDecisao,
): ResultadoDecisao {
  // Slots persistidos DENTRO do fluxo técnico: o cluster de data passa a ser o
  // da VISITA (o de `slotsData`), não o do casamento — senão a data do casamento
  // já coletada "vazava" como data da visita técnica no turno seguinte. O resto
  // (nome, convidados etc.) segue da conversa.
  // O casamento que o fornecedor atende (data, noivos, serviço) vai para campos PRÓPRIOS,
  // separados da data da visita, e se acumula entre os turnos.
  const casamento = nlu.casamentoAtendido;
  const persistir: Conversa = {
    ...base,
    slots: {
      ...base.slots,
      data: slotsData.data,
      mesDia: slotsData.mesDia,
      mes: slotsData.mes,
      dia: slotsData.dia,
      ano: slotsData.ano,
      dataCasamento: casamento?.data ?? base.slots.dataCasamento,
      casamentoNoivos: casamento?.noivos ?? base.slots.casamentoNoivos,
      fornecedorServico: casamento?.servico ?? base.slots.fornecedorServico,
    },
  };
  const dataISO = resolverDataTecnica(slotsData, ctx.agora);
  if (!dataISO) {
    return {
      conversa: { ...persistir, estado: 'visita_tecnica_data' },
      saidas: [pergunta(MSG.perguntaDataVisitaTecnica)],
    };
  }
  const validacao = validarVisitaTecnica(dataISO, ctx.agora);
  if (!validacao.ok) {
    return {
      conversa: { ...persistir, estado: 'visita_tecnica_data' },
      saidas: [texto(MSG.visitaTecnicaForaRegra(validacao.motivo))],
    };
  }
  // Uma vez no estado 'visita_tecnica_data', QUALQUER mensagem é tratada como
  // sendo sobre a visita técnica — mesmo que ela também traga um pedido novo,
  // tipo orçamento pro próprio casamento na mesma mensagem. `convidados` é o
  // sinal mais confiável disso: uma visita técnica nunca precisa desse dado,
  // só faz sentido se ela também estiver pedindo orçamento junto. Não tenta
  // separar os dois assuntos aqui (isso é decisão de negócio) — só avisa a
  // Raquel pra ela não se confundir e resolver com a cliente.
  const tambemPediuOrcamento = nlu.slots.convidados !== undefined;
  const casamentoTexto = resumoCasamentoAtendido(persistir.slots);
  const motivo =
    `visita técnica: ${descreverData(dataISO)}` +
    (casamentoTexto ? ` | casamento: ${casamentoTexto}` : '') +
    (tambemPediuOrcamento
      ? ' — atenção: mensagem também menciona nº de convidados, pode ser pedido de orçamento próprio junto'
      : '');
  // Dentro da regra: avisa que vai verificar e repassa para a Raquel confirmar.
  // A data da visita sai do conjunto de data (que é do evento de orçamento) e vai para o
  // campo próprio: `dataVisitaTecnica`. Assim `data`/`ano` não ficam parecendo a data do evento.
  // O dia da semana da visita também sai: ele já está dentro de `dataVisitaTecnica`.
  const { data: _d, mesDia: _md, mes: _m, dia: _di, ano: _a, diaSemana: _ds, ...slotsSemData } = persistir.slots;
  return {
    conversa: {
      ...persistir,
      slots: { ...slotsSemData, dataVisitaTecnica: dataISO },
      estado: 'handoff',
      motivoHandoff: motivo,
    },
    saidas: [pergunta(MSG.visitaTecnicaVouVerificar)],
  };
}

/**
 * Decide com base no que falta para orçar: dia (fim de semana/dia de semana) e nº
 * de convidados. Com tudo completo, segue para o mini wedding ou para
 * `avancarComData` (que cuida do ano/data). Compartilhada entre o estado
 * 'aguardando_qualificacao' e o primeiro contato, quando ele já veio com dados.
 */
function qualificar(
  base: Conversa,
  slots: Slots,
  nlu: EntradaNLU,
  ctx: ContextoDecisao,
): ResultadoDecisao {
  const faltando: string[] = [];
  if (!classificarDia(slots)) {
    faltando.push('se o evento é num sábado/domingo ou dia de semana');
  }
  if (slots.convidados === undefined) {
    faltando.push('o número estimado de convidados');
  }
  if (faltando.length > 0) {
    // Se a noiva quer visitar e ainda não deu NENHUM dado de orçamento, conduz
    // para a preferência de visita em vez de insistir na qualificação. Se ela já
    // deu algo (ex.: convidados, mas não o dia), continua pedindo o que falta:
    // "quero visitar" não substitui o orçamento, os dois seguem em paralelo.
    if (nlu.intencao === 'agendar_visita' && !temDadoDeOrcamento(slots)) {
      return {
        conversa: { ...base, estado: 'aguardando_pref_visita' },
        saidas: [texto(MSG.perguntaPreferenciaVisita)],
      };
    }
    return {
      conversa: base,
      saidas: [pergunta(MSG.pedirDadosFaltantes(faltando, ctx.seed))],
    };
  }

  // Mini wedding é SÓ dia de semana até 80 convidados: aí oferecemos o mini.
  if (ehMiniWedding(slots)) {
    return {
      conversa: { ...base, estado: 'aguardando_interesse_mini' },
      saidas: [texto(MSG.ofertaMini)],
    };
  }

  // Todo o resto (fim de semana, ou dia de semana com mais de 80) vai direto
  // para a proposta normal, sem etapa de confirmação: o PDF já traz o valor de
  // fim de semana e de evento grande de dia de semana. Regra confirmada pela Raquel.
  return avancarComData(base, slots, nlu, ctx);
}

/** Coloca `avisos` depois da abertura (texto + vídeo), antes da primeira mensagem do fluxo. */
function inserirAvisos(saidas: MensagemSaida[], avisos: MensagemSaida[]): MensagemSaida[] {
  let i = 0;
  while (
    i < saidas.length &&
    (saidas[i]?.tipo === 'video' ||
      saidas[i]?.texto === MSG.abertura ||
      saidas[i]?.texto === MSG.aberturaSemSaudacao)
  ) {
    i++;
  }
  return [...saidas.slice(0, i), ...avisos, ...saidas.slice(i)];
}

const inserirAviso = (saidas: MensagemSaida[], aviso: MensagemSaida): MensagemSaida[] =>
  inserirAvisos(saidas, [aviso]);

// Intenções que têm fluxo próprio ou exigem a Raquel: a dúvida frequente não se mete.
const INTENCOES_SEM_FAQ: Intencao[] = ['visita_tecnica', 'fornecedor', 'cliente_fechado', 'negociar', 'despedida'];

/**
 * Dúvida sobre hospedagem ou pacotes: responde com o texto da Raquel e deixa o fluxo seguir (na
 * abertura, o texto entra depois do vídeo e antes da pergunta de orçamento). Pergunta de valor
 * não tem texto próprio: o fluxo comercial já pede data e convidados.
 */
function responderDuvidas(conversa: Conversa, nlu: EntradaNLU, ctx: ContextoDecisao): ResultadoDecisao {
  const semDuvidas: EntradaNLU = { ...nlu, duvidas: undefined };
  const duvidas = nlu.duvidas ?? [];
  const respostas: MensagemSaida[] = [];
  if (duvidas.includes('hospedagem')) respostas.push(texto(MSG.faqHospedagem));
  if (duvidas.includes('pacotes')) respostas.push(texto(MSG.faqPacotes));

  const ignora =
    INTENCOES_SEM_FAQ.includes(nlu.intencao) ||
    conversa.estado === 'visita_tecnica_data' ||
    // Na oferta do mini, a dúvida segue o caminho dela: PDF do mini e repasse à Raquel.
    conversa.estado === 'aguardando_interesse_mini';
  if (ignora) return decidir(conversa, semDuvidas, ctx);

  // Combinando a visita: uma dúvida solta não é resposta ao "que dia fica melhor?", e o fluxo da
  // visita trataria como "sem dia" e repassaria à Raquel. Responde a dúvida e, se perguntou valor,
  // volta ao orçamento (a mesma mensagem de data e convidados).
  const dandoDiaDaVisita = nlu.visita?.dataHora !== undefined || nlu.visita?.diaSemana !== undefined;
  if (conversa.estado === 'aguardando_pref_visita' && !dandoDiaDaVisita) {
    const slots = mesclarSlots(conversa.slots, { ...nlu.slots, nome: nlu.nomeDetectado ?? undefined });
    const base: Conversa = { ...conversa, slots, atualizadoEm: ctx.agora, ultimaEntradaEm: ctx.agora };
    if (!duvidas.includes('valores')) return { conversa: base, saidas: respostas };
    // Sem nenhum dado de orçamento ainda: a mensagem de data da Raquel (regra de 16/10: tudo sobre
    // valores recebe essa mensagem). Com dados, pede só o que falta.
    const orcamento = temDadoDeOrcamento(slots)
      ? qualificar({ ...base, estado: 'aguardando_qualificacao' }, slots, nlu, ctx)
      : { conversa: { ...base, estado: 'aguardando_qualificacao' as const }, saidas: [texto(MSG.perguntaQualificadora)] };
    return { conversa: orcamento.conversa, saidas: [...respostas, ...orcamento.saidas] };
  }

  const r = decidir(conversa, semDuvidas, ctx);
  if (r.conversa.estado === 'handoff' || r.conversa.estado === 'humano') {
    // Fechar a visita termina em handoff, e a resposta da dúvida ainda cabe antes. Nos outros
    // repasses (a Raquel precisa assumir por outro motivo) o bot não se mete.
    const fechouVisita = conversa.estado === 'aguardando_pref_visita';
    return fechouVisita ? { conversa: r.conversa, saidas: [...respostas, ...r.saidas] } : r;
  }
  return { conversa: r.conversa, saidas: inserirAvisos(r.saidas, respostas) };
}

export function decidir(
  conversa: Conversa,
  nlu: EntradaNLU,
  ctx: ContextoDecisao,
): ResultadoDecisao {
  // Conversa já assumida pela Raquel: o bot não age.
  if (conversa.estado === 'humano' || conversa.estado === 'handoff') {
    return { conversa, saidas: [] };
  }

  // Pediu 2029 (a agenda abre em janeiro de 2027). Orientação da Raquel: avisar e mandar os
  // valores de 2028 como base para ela poder marcar uma visita. O resto do fluxo é o normal,
  // só que com 2028: cobre cada estado (pergunta o que falta, oferta mini, proposta) sem
  // duplicar regra. O aviso sai uma vez; depois só vai o que o fluxo mandaria.
  if (nlu.anoIndisponivel !== undefined) {
    const comBase: EntradaNLU = {
      ...nlu,
      anoIndisponivel: undefined,
      slots: { ...nlu.slots, ano: 2028, anoSolicitado: nlu.anoIndisponivel },
    };
    const r = decidir(conversa, comBase, ctx);
    if (r.conversa.estado === 'handoff' || r.conversa.estado === 'humano') return r;
    const jaAvisou = conversa.slots.anoSolicitado !== undefined;
    if (jaAvisou) return r;
    const aviso = texto(MSG.agenda2029);
    return { conversa: r.conversa, saidas: inserirAviso(r.saidas, aviso) };
  }

  if (nlu.duvidas !== undefined) return responderDuvidas(conversa, nlu, ctx);

  const slots = mesclarSlots(conversa.slots, {
    ...nlu.slots,
    nome: nlu.nomeDetectado ?? undefined,
  });
  const base: Conversa = {
    ...conversa,
    slots,
    atualizadoEm: ctx.agora,
    ultimaEntradaEm: ctx.agora,
  };

  // Antes do fluxo comercial começar (nada foi enviado ainda): 'novo' e a espera
  // pelo assunto depois de um cumprimento.
  const primeiroContato = conversa.estado === 'novo' || conversa.estado === 'aguardando_assunto';

  const handoff = (motivo: string): ResultadoDecisao => ({
    conversa: { ...base, estado: 'handoff', motivoHandoff: motivo },
    saidas: [],
  });

  // Encerra com cordialidade e para de puxar convite. Fica em 'encerrada' até a
  // noiva voltar com um pedido concreto (tratado no case 'encerrada').
  const encerrar = (): ResultadoDecisao => ({
    conversa: { ...base, estado: 'encerrada' },
    saidas: [pergunta(vary(MSG.encerramento, ctx.seed))],
  });

  // Visita técnica tem fluxo próprio (valida e repassa), em qualquer estado.
  if (nlu.intencao === 'visita_tecnica' || conversa.estado === 'visita_tecnica_data') {
    // Na ENTRADA do fluxo, só a data desta mensagem vale como data da visita:
    // sem isso, a data do CASAMENTO já coletada virava a data da visita técnica.
    // Já DENTRO do fluxo, os slots mesclados combinam as partes dadas por turno
    // (o cluster de data da conversa já é o da visita, ver fluxoVisitaTecnica).
    const entrando = conversa.estado !== 'visita_tecnica_data';
    const slotsData = entrando ? mesclarSlots({}, nlu.slots) : slots;
    return fluxoVisitaTecnica(base, slotsData, nlu, ctx);
  }

  // Despedida em qualquer ponto (menos no meio de coletar dados que ela acabou de
  // dar): agradece e para. Um "não" cru é tratado dentro de cada estado de convite.
  // Se já está encerrada, não reenvia a mensagem: cai no case 'encerrada' (quieto).
  if (
    nlu.intencao === 'despedida' &&
    !trouxeDadoDeOrcamento(nlu) &&
    conversa.estado !== 'encerrada'
  ) {
    return encerrar();
  }

  // Não é noiva (fornecedor, parceria, imprensa): avisa que vai chamar a Raquel e
  // transborda, em QUALQUER estado (inclusive no primeiro contato).
  if (nlu.intencao === 'fornecedor') {
    return {
      conversa: { ...base, estado: 'handoff', motivoHandoff: 'fornecedor/parceria (não é noiva)' },
      saidas: [pergunta(MSG.fornecedorEncaminhar)],
    };
  }

  // Intenções que exigem humano (negociar, fora do script, cliente fechado) têm
  // prioridade, exceto no primeiro contato (tratado logo abaixo). A visita de
  // noiva NÃO é handoff: é coletada no fluxo (ver casos abaixo).
  const motivo = motivoDaIntencao(nlu.intencao);
  // Pergunta logo depois da oferta do mini ("tem hospedagem?", "o que inclui?"): é
  // sobre o mini, e o PDF responde (hospedagem, valores). Manda o PDF e repassa a
  // pergunta para a Raquel, que responde o que o PDF não cobre. Sem aviso: segue o
  // padrão de handoff silencioso.
  if (conversa.estado === 'aguardando_interesse_mini' && nlu.intencao === 'fora_do_script') {
    return {
      conversa: { ...base, estado: 'handoff', motivoHandoff: motivo ?? 'pergunta fora do script' },
      saidas: [texto(MSG.miniInformacoes), { tipo: 'pdf', pdf: 'proposta_mini' }],
    };
  }
  if (motivo && !primeiroContato) {
    return handoff(motivo);
  }
  // No primeiro contato, "cliente já fechado" transborda em silêncio; dúvida
  // fora do script ou negociação avisa que vai verificar e repassa a pergunta
  // pra Raquel, sem fluxo comercial (cliente, assessoria e dúvida não recebem vídeo).
  if (primeiroContato && nlu.intencao === 'cliente_fechado') {
    return handoff('cliente que já fechou');
  }
  if (
    primeiroContato &&
    motivo &&
    (nlu.intencao === 'fora_do_script' || nlu.intencao === 'negociar')
  ) {
    return {
      conversa: { ...base, estado: 'handoff', motivoHandoff: motivo },
      // Sem vídeo, mesmo com data na mensagem: "sou a Bruna, noiva do dia 21/08, dúvida
      // do pagamento" tem data e é cliente fechada. Quem quer orçar E perguntar fala
      // com a Raquel, que conduz.
      saidas: [pergunta(MSG.duvidaVouVerificar)],
    };
  }

  switch (conversa.estado) {
    case 'novo':
    case 'aguardando_assunto': {
      // Só um cumprimento ("oi", "bom dia"): não inicia o fluxo comercial. Pergunta
      // como pode ajudar e espera o assunto. Se a pessoa cumprimentar de novo
      // enquanto espera, fica quieta (já perguntou).
      if (nlu.intencao === 'saudacao' && !temDadoDeOrcamento(slots)) {
        if (conversa.estado === 'aguardando_assunto') return { conversa: base, saidas: [] };
        return {
          conversa: { ...base, estado: 'aguardando_assunto' },
          saidas: [texto(MSG.comoPosso)],
        };
      }

      // Pediu orçamento (ou falou de outra coisa que cabe no fluxo): abertura da
      // Raquel + vídeo. A abertura nunca é humanizada (texto de marca literal).
      // Inclui as partes soltas de data (mesDia/mes/dia): quem abre com "quero
      // orçamento pra 26 de janeiro" não pode receber a qualificadora pedindo a
      // data de novo.
      const jaVeioAlgumDado = temDadoDeOrcamento(slots);
      // Depois do "como posso ajudar" o bot já cumprimentou: a abertura vai sem saudação.
      const aberturaMsgs = abertura(conversa.estado === 'aguardando_assunto');

      // Só quer conhecer o espaço (sem dados de orçamento): abre e já vai
      // para a preferência de visita, em vez de pedir dados de orçamento.
      if (nlu.intencao === 'agendar_visita' && !jaVeioAlgumDado) {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [...aberturaMsgs, texto(MSG.perguntaPreferenciaVisita)],
        };
      }

      // Nada foi adiantado ainda: pergunta qualificadora LITERAL (texto oficial
      // da Raquel, não humanizado) pedindo tudo de uma vez.
      if (!jaVeioAlgumDado) {
        return {
          conversa: { ...base, estado: 'aguardando_qualificacao' },
          saidas: [...aberturaMsgs, texto(MSG.perguntaQualificadora)],
        };
      }

      // Ela já adiantou algo no próprio primeiro contato (comum em áudio, onde a
      // pessoa fala tudo de uma vez): não repete o que ela já disse. Reaproveita a
      // mesma lógica de 'aguardando_qualificacao' — pergunta só o que falta, ou já
      // avança para a oferta/proposta se veio tudo.
      const seguinte = qualificar({ ...base, estado: 'aguardando_qualificacao' }, slots, nlu, ctx);
      return { conversa: seguinte.conversa, saidas: [...aberturaMsgs, ...seguinte.saidas] };
    }

    case 'aguardando_qualificacao':
      // Já recebeu a retomada do orçamento (follow-up) e disse que não quer: encerra com cordialidade
      // em vez de pedir de novo a data e os convidados.
      if (conversa.followupEnviadoEm && nlu.negativo && !trouxeDadoDeOrcamento(nlu)) return encerrar();
      return qualificar(base, slots, nlu, ctx);

    case 'aguardando_interesse_mini':
      // Regressão: ela responde com uma DATA em vez de "sim" ("15 de março de
      // 2027") — o NLU corretamente não marca afirmativo/negativo quando a
      // mensagem traz um dado novo, mas dar uma data pra um convite de mini
      // wedding SÓ faz sentido como aceite. Sem isso, caía no fallback "sem
      // sim/não claro" e a proposta nunca era enviada.
      if (nlu.afirmativo || trouxeDadoDeOrcamento(nlu)) {
        // O dado novo pode ter mudado o enquadramento ("na verdade vai ser no
        // sábado", "vão ser 150"): re-qualifica em vez de mandar o mini errado.
        // Só quando VEIO dado novo — um "sim" puro não muda nada do que já
        // levou a conversa até a oferta do mini.
        if (trouxeDadoDeOrcamento(nlu) && !ehMiniWedding(slots)) {
          return qualificar({ ...base, estado: 'aguardando_qualificacao' }, slots, nlu, ctx);
        }
        // Data concreta em jogo: mesmas checagens do fluxo normal.
        const dataISO = dataCompleta(slots);
        if (dataISO && dataNoPassado(dataISO, ctx.agora)) {
          return { conversa: base, saidas: [pergunta(vary(MSG.dataNoPassado, ctx.seed))] };
        }
        const checagem = checarDisponibilidade(base, slots, nlu, ctx);
        if ('bloqueio' in checagem) return checagem.bloqueio;
        // A alternativa adotada pode cair num dia que tira o evento do mini
        // (ex.: um sábado): re-qualifica com a data nova em vez de mandar o mini.
        // Só quando os slots MUDARAM (houve adoção) — no caminho comum a
        // checagem devolve os mesmos slots e o enquadramento já foi validado.
        if (checagem.slots !== slots && !ehMiniWedding(checagem.slots)) {
          return qualificar(
            { ...base, slots: checagem.slots, estado: 'aguardando_qualificacao' },
            checagem.slots,
            nlu,
            ctx,
          );
        }
        return {
          conversa: propostaEnviada({ ...base, slots: checagem.slots }),
          saidas: [
            texto(MSG.orcamentoMiniAnuncio),
            { tipo: 'pdf', pdf: 'proposta_mini' },
            texto(MSG.conviteVisitaPosProposta),
          ],
        };
      }
      // Indecisa ("vou pensar", "vou ver com meu noivo"): não recusou, então recebe o
      // PDF do mini para levar na conversa, em vez de ouvir a pergunta das tradicionais.
      if (nlu.indeciso) {
        return {
          conversa: propostaEnviada(base),
          saidas: [
            texto(MSG.miniInformacoes),
            { tipo: 'pdf', pdf: 'proposta_mini' },
            texto(MSG.conviteVisitaPosProposta),
          ],
        };
      }
      // Recusou o mini: pergunta se pode mandar as propostas tradicionais (que
      // incluem final de semana). Regra da Raquel, 14/10/2026.
      if (nlu.negativo) {
        return {
          conversa: { ...base, estado: 'aguardando_aceite_tradicional' },
          saidas: [texto(MSG.ofertaTradicional)],
        };
      }
      // Quer conhecer o espaço em vez de responder à oferta: vai para a visita.
      if (nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [texto(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Sem sim/não claro (perguntou o valor, o que inclui, "vou ver com meu
      // noivo"): manda o PDF do mini com as informações, em vez de insistir.
      return {
        conversa: propostaEnviada(base),
        saidas: [
          texto(MSG.miniInformacoes),
          { tipo: 'pdf', pdf: 'proposta_mini' },
          texto(MSG.conviteVisitaPosProposta),
        ],
      };

    case 'aguardando_aceite_tradicional':
      // Disse sim, ou respondeu com um dado (o ano, uma data): quer as propostas
      // tradicionais. Marca a recusa do mini e segue a qualificação normal, que
      // agora não oferece o mini de novo (pergunta o ano/data se faltar).
      if (nlu.afirmativo || trouxeDadoDeOrcamento(nlu)) {
        const comRecusa: Slots = { ...slots, tradicionalAceito: true };
        return qualificar(
          { ...base, slots: comRecusa, estado: 'aguardando_qualificacao' },
          comRecusa,
          nlu,
          ctx,
        );
      }
      if (nlu.negativo) {
        return encerrar();
      }
      if (nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [texto(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Sem sinal claro: fica quieta, ela segue de onde parou.
      return { conversa: base, saidas: [] };

    case 'proposta_enviada':
      // A noiva voltou com dados novos (outro ano, outra data, outro nº de
      // convidados): re-cotamos em vez de ignorar. Ex.: "e para 2028?". Só conta o que
      // MUDA: o modelo às vezes reemite os dados já coletados sem a pessoa ter dito nada.
      if (trouxeDadoDiferente(conversa.slots, nlu)) {
        return decidir({ ...base, estado: 'aguardando_qualificacao' }, nlu, ctx);
      }
      // A proposta (e o follow-up) trazem o convite de visita: um "sim/vamos/ok" é o
      // aceite. Pergunta o dia e, na resposta, repassa para a Raquel marcar
      // (ADR-0005 rev.: o bot não agenda a visita de noiva).
      if (nlu.afirmativo || nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [texto(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Recusou a visita de propósito: agradece UMA vez e encerra. É o fim do
      // loop do print (antes o bot re-perguntava o convite a cada "não").
      if (nlu.negativo) {
        return encerrar();
      }
      // Regressão: isso ERA um fallback incondicional (fechava a conversa pra
      // QUALQUER coisa que não fosse sim/dado novo/agendar_visita — inclusive
      // uma simples correção de nome, "kkk", ou comentário solto). Despedida de
      // verdade já é pega pelo guard do topo de `decidir`; aqui, sem sinal
      // claro, o certo é não fechar a conversa sozinha nem insistir de novo no
      // convite de visita — fica quieta, ela segue de onde parou no próximo dado.
      return { conversa: base, saidas: [] };

    case 'aguardando_pref_visita': {
      // Desistiu da visita ("não", "deixa pra depois"): encerra sem repassar.
      if (nlu.negativo) {
        return encerrar();
      }
      // Pediu um dia/horário FORA do que o bot anunciou (domingo, sábado à tarde, noite):
      // não diz "não". Abre uma exceção, que a equipe avalia, e repassa para a Raquel.
      const fora = nlu.visita ? visitaForaDoHorario(nlu.visita, ctx.agora) : undefined;
      if (fora) {
        return {
          conversa: {
            ...base,
            estado: 'handoff',
            motivoHandoff: `visita FORA DO HORÁRIO (${fora.quando}): pedir exceção à equipe`,
          },
          saidas: [texto(MSG.visitaExcecao(fora.quando))],
        };
      }
      // A noiva deu um dia/horário CONCRETO: o bot não tem calendário, então só
      // acusa o que ela pediu e repassa para a Raquel confirmar.
      const quando = nlu.visita?.dataHora;
      if (quando) {
        return {
          conversa: { ...base, estado: 'handoff', motivoHandoff: `visita da noiva (${quando})` },
          saidas: [pergunta(MSG.visitaComData(quando))],
        };
      }
      // Ela só deu preferência (ou deixou em aberto): o bot NÃO promete um dia,
      // diz que vai ver na agenda e repassa a preferência (se houver) à Raquel.
      return {
        conversa: {
          ...base,
          estado: 'handoff',
          motivoHandoff: `visita da noiva${prefVisitaTexto(nlu)}`,
        },
        saidas: [pergunta(MSG.visitaVouRetornar)],
      };
    }

    case 'encerrada': {
      // Já agradecemos e paramos. Só reabrimos se a noiva voltar com algo
      // concreto. As intenções que exigem humano (negociar, dúvida, fornecedor,
      // cliente fechado, visita técnica) já foram tratadas acima. Aqui cuidamos
      // de nova cotação e de aceite de visita.
      if (trouxeDadoDiferente(conversa.slots, nlu)) {
        return decidir({ ...base, estado: 'aguardando_qualificacao' }, nlu, ctx);
      }
      // Só reabre a visita num PEDIDO claro. Um "ok"/"tá" solto depois da despedida
      // é só a noiva reconhecendo o encerramento, não um "sim, quero visitar":
      // por isso NÃO reabrimos em afirmativo aqui (ficaríamos empurrando visita).
      if (nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [texto(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Nada concreto (um "ok", "não", agradecimento, silêncio): fica quieto.
      return { conversa: base, saidas: [] };
    }

    default:
      return { conversa: base, saidas: [] };
  }
}
