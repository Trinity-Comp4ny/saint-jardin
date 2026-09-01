// Máquina de estados determinística da conversa.
// É uma função PURA: mesmas entradas -> mesmas saídas. O LLM fica FORA daqui
// (a leitura da mensagem chega pronta em EntradaNLU), o que torna cada ramo
// testável sem chamar Claude nem WhatsApp.

import {
  DIAS_DE_SEMANA,
  LIMITE_MINI_WEDDING,
  type Ano,
  type Conversa,
  type EntradaNLU,
  type MensagemSaida,
  type PreferenciaDia,
  type Slots,
} from './types';
import { MSG } from './persona';
import { pdfPropostaPorAno } from './pdfs';
import { descreverData, resolverDataTecnica, validarVisitaTecnica } from './visita';

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
export function classificarDia(slots: Slots): PreferenciaDia | undefined {
  if (slots.diaSemana) {
    return DIAS_DE_SEMANA.includes(slots.diaSemana) ? 'dia_de_semana' : 'fim_de_semana';
  }
  return slots.preferenciaDia;
}

/**
 * Regra de negócio (confirmada com a Raquel): mini wedding é SÓ dia de semana
 * (seg-qui) E até 80 convidados. Fim de semana com poucos convidados, ou dia de
 * semana com mais de 80, vão para o valor normal — não se enquadram no mini.
 */
export function ehMiniWedding(slots: Slots): boolean {
  const dia = classificarDia(slots);
  const cabeNoMini =
    slots.convidados !== undefined && slots.convidados <= LIMITE_MINI_WEDDING;
  return dia === 'dia_de_semana' && cabeNoMini;
}

export function mesclarSlots(atual: Slots, novo: Slots): Slots {
  const mes = novo.mes ?? atual.mes;
  const dia = novo.dia ?? atual.dia;
  let mesDia = novo.mesDia ?? atual.mesDia;
  // Mês e dia vieram em mensagens diferentes ("outubro" e depois "30"): combina
  // no MM-DD canônico, para o resto do fluxo continuar usando só `mesDia`.
  if (!mesDia && mes && dia) {
    mesDia = `${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  return {
    data: novo.data ?? atual.data,
    mesDia,
    mes,
    dia,
    ano: novo.ano ?? atual.ano,
    diaSemana: novo.diaSemana ?? atual.diaSemana,
    preferenciaDia: novo.preferenciaDia ?? atual.preferenciaDia,
    convidados: novo.convidados ?? atual.convidados,
    nome: novo.nome ?? atual.nome,
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

/** Data ISO completa: a data explícita, ou dia/mês combinado com o ano já sabido. */
export function dataCompleta(slots: Slots): string | undefined {
  if (slots.data) return slots.data;
  if (slots.mesDia && slots.ano) return `${slots.ano}-${slots.mesDia}`;
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

/**
 * Evento de valor normal com dia e convidados já sabidos: cuida da data.
 * Pergunta a data específica; se vier só dia/mês, pergunta o ano; com o ano
 * definido (direto ou pela data completa), checa disponibilidade e envia a proposta.
 */
function avancarComData(
  base: Conversa,
  slots: Slots,
  ctx: ContextoDecisao,
): ResultadoDecisao {
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

  const dataISO = dataCompleta(slots);
  // Data específica já no passado: avisa e pede uma data futura.
  if (dataISO && dataNoPassado(dataISO, ctx.agora)) {
    return { conversa: base, saidas: [pergunta(vary(MSG.dataNoPassado, ctx.seed))] };
  }

  // Data completa em jogo e ocupada: oferece alternativa.
  const disp = ctx.disponibilidadeData;
  if (dataISO && disp && disp.data === dataISO && !disp.livre) {
    return {
      conversa: base,
      saidas: [texto(MSG.dataIndisponivel(dataISO, disp.alternativa ?? 'outra data'))],
    };
  }

  return {
    conversa: { ...base, estado: 'proposta_enviada' },
    saidas: [
      texto(MSG.orcamentoNormalAnuncio),
      { tipo: 'pdf', pdf: pdfPropostaPorAno(ano) },
      texto(MSG.orcamentoNormalDescricao),
      pergunta(MSG.conviteVisita),
    ],
  };
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
  slots: Slots,
  ctx: ContextoDecisao,
): ResultadoDecisao {
  const dataISO = resolverDataTecnica(slots, ctx.agora);
  if (!dataISO) {
    return {
      conversa: { ...base, estado: 'visita_tecnica_data' },
      saidas: [pergunta(MSG.perguntaDataVisitaTecnica)],
    };
  }
  const validacao = validarVisitaTecnica(dataISO, ctx.agora);
  if (!validacao.ok) {
    return {
      conversa: { ...base, estado: 'visita_tecnica_data' },
      saidas: [texto(MSG.visitaTecnicaForaRegra(validacao.motivo))],
    };
  }
  // Dentro da regra: avisa que vai verificar e repassa para a Raquel confirmar.
  return {
    conversa: {
      ...base,
      estado: 'handoff',
      motivoHandoff: `visita técnica: ${descreverData(dataISO)}`,
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
    const nenhumDadoAinda = !classificarDia(slots) && slots.convidados === undefined;
    if (nlu.intencao === 'agendar_visita' && nenhumDadoAinda) {
      return {
        conversa: { ...base, estado: 'aguardando_pref_visita' },
        saidas: [pergunta(MSG.perguntaPreferenciaVisita)],
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
  return avancarComData(base, slots, ctx);
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

  const slots = mesclarSlots(conversa.slots, {
    ...nlu.slots,
    nome: nlu.nomeDetectado ?? undefined,
  });
  const base: Conversa = { ...conversa, slots, atualizadoEm: ctx.agora };

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
    return fluxoVisitaTecnica(base, slots, ctx);
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
  // prioridade, exceto na primeira saudação (apresentamos o espaço antes). A
  // visita de noiva NÃO é handoff: é coletada no fluxo (ver casos abaixo).
  const motivo = motivoDaIntencao(nlu.intencao);
  if (motivo && conversa.estado !== 'novo') {
    return handoff(motivo);
  }
  // No primeiro contato, só o caso "cliente já fechado" transborda de imediato.
  if (conversa.estado === 'novo' && nlu.intencao === 'cliente_fechado') {
    return handoff('cliente que já fechou');
  }

  switch (conversa.estado) {
    case 'novo': {
      // Primeiro contato: saudação (com o nome, ou pedindo o nome) + apresentação
      // em PDF. A saudação já personaliza/pede o nome; a apresentação nunca é
      // humanizada (texto de marca literal).
      const apresentacao: MensagemSaida[] = [
        texto(MSG.apresentacao(slots.nome)),
        { tipo: 'pdf', pdf: 'apresentacao' },
      ];

      const jaVeioAlgumDado =
        slots.data !== undefined ||
        slots.ano !== undefined ||
        slots.diaSemana !== undefined ||
        slots.preferenciaDia !== undefined ||
        slots.convidados !== undefined;

      // Só quer conhecer o espaço (sem dados de orçamento): apresenta e já vai
      // para a preferência de visita, em vez de pedir dados de orçamento.
      if (nlu.intencao === 'agendar_visita' && !jaVeioAlgumDado) {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [...apresentacao, pergunta(MSG.perguntaPreferenciaVisita)],
        };
      }

      // Nada foi adiantado ainda: abertura padrão, pergunta qualificadora LITERAL
      // (texto oficial da Raquel, não humanizado) pedindo tudo de uma vez.
      if (!jaVeioAlgumDado) {
        return {
          conversa: { ...base, estado: 'aguardando_qualificacao' },
          saidas: [...apresentacao, texto(MSG.perguntaQualificadora)],
        };
      }

      // Ela já adiantou algo no próprio primeiro contato (comum em áudio, onde a
      // pessoa fala tudo de uma vez): não repete o que ela já disse. Reaproveita a
      // mesma lógica de 'aguardando_qualificacao' — pergunta só o que falta, ou já
      // avança para a oferta/proposta se veio tudo.
      const seguinte = qualificar({ ...base, estado: 'aguardando_qualificacao' }, slots, nlu, ctx);
      return { conversa: seguinte.conversa, saidas: [...apresentacao, ...seguinte.saidas] };
    }

    case 'aguardando_qualificacao':
      return qualificar(base, slots, nlu, ctx);

    case 'aguardando_interesse_mini':
      // Regressão: ela responde com uma DATA em vez de "sim" ("15 de março de
      // 2027") — o NLU corretamente não marca afirmativo/negativo quando a
      // mensagem traz um dado novo, mas dar uma data pra um convite de mini
      // wedding SÓ faz sentido como aceite. Sem isso, caía no fallback "sem
      // sim/não claro" e a proposta nunca era enviada.
      if (nlu.afirmativo || trouxeDadoDeOrcamento(nlu)) {
        return {
          conversa: { ...base, estado: 'proposta_enviada' },
          saidas: [
            texto(MSG.orcamentoMiniAnuncio),
            { tipo: 'pdf', pdf: 'proposta_mini' },
            pergunta(MSG.conviteVisita),
          ],
        };
      }
      // Recusou o mini de propósito: respeita e encerra (não empurra visita).
      if (nlu.negativo) {
        return encerrar();
      }
      // Sem sim/não claro: convida para a visita (um único convite).
      return {
        conversa: { ...base, estado: 'proposta_enviada' },
        saidas: [pergunta(MSG.conviteVisita)],
      };

    case 'proposta_enviada':
      // A noiva voltou com dados novos (outro ano, outra data, outro nº de
      // convidados): re-cotamos em vez de ignorar. Ex.: "e para 2028?".
      if (trouxeDadoDeOrcamento(nlu)) {
        return decidir({ ...base, estado: 'aguardando_qualificacao' }, nlu, ctx);
      }
      // Orçamento já foi e o único convite em aberto é a visita. Um "sim/vamos"
      // é aceite: pergunta a preferência de dia e, na resposta, repassa para a
      // Raquel marcar (ADR-0005 rev.: o bot não agenda a visita de noiva).
      if (nlu.afirmativo || nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [pergunta(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Recusou a visita: agradece UMA vez e encerra. É o fim do loop do print
      // (antes o bot re-perguntava o convite a cada "não").
      return encerrar();

    case 'aguardando_pref_visita': {
      // Desistiu da visita ("não", "deixa pra depois"): encerra sem repassar.
      if (nlu.negativo) {
        return encerrar();
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
      if (trouxeDadoDeOrcamento(nlu)) {
        return decidir({ ...base, estado: 'aguardando_qualificacao' }, nlu, ctx);
      }
      // Só reabre a visita num PEDIDO claro. Um "ok"/"tá" solto depois da despedida
      // é só a noiva reconhecendo o encerramento, não um "sim, quero visitar":
      // por isso NÃO reabrimos em afirmativo aqui (ficaríamos empurrando visita).
      if (nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [pergunta(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Nada concreto (um "ok", "não", agradecimento, silêncio): fica quieto.
      return { conversa: base, saidas: [] };
    }

    default:
      return { conversa: base, saidas: [] };
  }
}
