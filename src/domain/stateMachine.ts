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
}

export interface ResultadoDecisao {
  conversa: Conversa;
  saidas: MensagemSaida[];
}

const texto = (t: string): MensagemSaida => ({ tipo: 'texto', texto: t });

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

function mesclarSlots(atual: Slots, novo: Slots): Slots {
  return {
    data: novo.data ?? atual.data,
    mesDia: novo.mesDia ?? atual.mesDia,
    ano: novo.ano ?? atual.ano,
    diaSemana: novo.diaSemana ?? atual.diaSemana,
    preferenciaDia: novo.preferenciaDia ?? atual.preferenciaDia,
    convidados: novo.convidados ?? atual.convidados,
  };
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

function motivoDaIntencao(intencao: EntradaNLU['intencao']): string | null {
  switch (intencao) {
    case 'cliente_fechado':
      return 'cliente que já fechou';
    case 'agendar_visita':
      return 'quer agendar visita';
    case 'negociar':
      return 'quer negociar valor ou condição';
    case 'fora_do_script':
      return 'pergunta fora do script';
    default:
      return null;
  }
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
    // Sem ano ainda: se já temos o dia/mês, falta só o ano; senão, pedimos a data.
    const pergunta = slots.mesDia ? MSG.perguntaAno : MSG.perguntaData;
    return { conversa: base, saidas: [texto(pergunta)] };
  }

  // Data completa em jogo e ocupada: oferece alternativa.
  const dataISO = dataCompleta(slots);
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
      texto(MSG.orcamentoNormal),
      { tipo: 'pdf', pdf: pdfPropostaPorAno(ano) },
      texto(MSG.conviteVisita),
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
      saidas: [texto(MSG.perguntaDataVisitaTecnica)],
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
    saidas: [texto(MSG.visitaTecnicaVouVerificar)],
  };
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

  const slots = mesclarSlots(conversa.slots, nlu.slots);
  const base: Conversa = { ...conversa, slots, atualizadoEm: ctx.agora };

  const handoff = (motivo: string): ResultadoDecisao => ({
    conversa: { ...base, estado: 'handoff', motivoHandoff: motivo },
    saidas: [],
  });

  // Visita técnica tem fluxo próprio (valida e repassa), em qualquer estado.
  if (nlu.intencao === 'visita_tecnica' || conversa.estado === 'visita_tecnica_data') {
    return fluxoVisitaTecnica(base, slots, ctx);
  }

  // Intenções que exigem humano têm prioridade, exceto na primeira saudação
  // (queremos ao menos apresentar o espaço antes de transbordar). A visita de
  // noiva é coletada aqui (proposta_enviada / aguardando_pref_visita), então
  // "agendar_visita" nesses estados NÃO vira handoff genérico; negociar/fora seguem.
  const coletandoVisita =
    conversa.estado === 'proposta_enviada' || conversa.estado === 'aguardando_pref_visita';
  const motivo = motivoDaIntencao(nlu.intencao);
  if (motivo && conversa.estado !== 'novo' && !(nlu.intencao === 'agendar_visita' && coletandoVisita)) {
    return handoff(motivo);
  }
  // No primeiro contato, só o caso "cliente já fechado" transborda de imediato.
  if (conversa.estado === 'novo' && nlu.intencao === 'cliente_fechado') {
    return handoff('cliente que já fechou');
  }

  switch (conversa.estado) {
    case 'novo': {
      // O primeiro contato sempre apresenta o espaço (texto + PDF).
      const apresentacao: MensagemSaida[] = [
        texto(MSG.apresentacao),
        { tipo: 'pdf', pdf: 'apresentacao' },
      ];

      const jaVeioAlgumDado =
        slots.data !== undefined ||
        slots.ano !== undefined ||
        slots.diaSemana !== undefined ||
        slots.preferenciaDia !== undefined ||
        slots.convidados !== undefined;

      // Nada de útil na 1ª mensagem: faz a pergunta qualificadora completa.
      if (!jaVeioAlgumDado) {
        return {
          conversa: { ...base, estado: 'aguardando_qualificacao' },
          saidas: [...apresentacao, texto(MSG.perguntaQualificadora)],
        };
      }

      // A pessoa já adiantou informação (data, dia, convidados...): apresenta e
      // já avança na qualificação com os dados que temos, sem repetir a pergunta.
      const proximo = decidir({ ...base, estado: 'aguardando_qualificacao' }, nlu, ctx);
      return { conversa: proximo.conversa, saidas: [...apresentacao, ...proximo.saidas] };
    }

    case 'aguardando_qualificacao': {
      const faltando: string[] = [];
      if (!classificarDia(slots)) {
        faltando.push('se o evento é num sábado/domingo ou dia de semana');
      }
      if (slots.convidados === undefined) {
        faltando.push('o número estimado de convidados');
      }
      if (faltando.length > 0) {
        return {
          conversa: base,
          saidas: [texto(MSG.pedirDadosFaltantes(faltando))],
        };
      }

      if (ehMiniWedding(slots)) {
        return {
          conversa: { ...base, estado: 'aguardando_interesse_mini' },
          saidas: [texto(MSG.ofertaMini)],
        };
      }

      // Dia de semana acima do limite do mini (>80): não cabe no mini. Explica e
      // espera a noiva confirmar que quer a proposta normal antes de enviá-la.
      if (classificarDia(slots) === 'dia_de_semana' && slots.convidados !== undefined) {
        return {
          conversa: { ...base, estado: 'aguardando_confirmacao_normal' },
          saidas: [texto(MSG.explicaLimiteNormal(slots.convidados))],
        };
      }

      // Fim de semana (valor normal): segue para a data e a proposta.
      return avancarComData(base, slots, ctx);
    }

    case 'aguardando_confirmacao_normal': {
      // A noiva pode ter corrigido os dados (ex.: reduziu convidados) e agora caber no mini.
      if (ehMiniWedding(slots)) {
        return {
          conversa: { ...base, estado: 'aguardando_interesse_mini' },
          saidas: [texto(MSG.ofertaMini)],
        };
      }
      if (nlu.afirmativo) {
        // Confirmou: daqui é só coletar data/ano e mandar a proposta. Transiciona
        // para um estado próprio para não voltar à qualificação (que re-explicaria
        // o limite) nem repetir a explicação a cada resposta que não seja "sim".
        return avancarComData({ ...base, estado: 'aguardando_data_normal' }, slots, ctx);
      }
      // Sem "sim" claro: reforça o convite à proposta, sem mandar o PDF ainda.
      return {
        conversa: base,
        saidas: [texto(MSG.explicaLimiteNormal(slots.convidados ?? LIMITE_MINI_WEDDING))],
      };
    }

    case 'aguardando_data_normal':
      // Proposta normal já confirmada: só falta a data/ano para escolher o PDF.
      return avancarComData(base, slots, ctx);

    case 'aguardando_interesse_mini':
      if (nlu.afirmativo) {
        return {
          conversa: { ...base, estado: 'proposta_enviada' },
          saidas: [texto(MSG.orcamentoMini), texto(MSG.conviteVisita)],
        };
      }
      // Sem interesse claro: ainda assim convida para visita.
      return {
        conversa: { ...base, estado: 'proposta_enviada' },
        saidas: [texto(MSG.conviteVisita)],
      };

    case 'proposta_enviada':
      // Orçamento já foi e o único convite em aberto é a visita. Um "sim/vamos"
      // é aceite: pergunta a preferência de dia e, na resposta, repassa para a
      // Raquel marcar (ADR-0005 rev.: o bot não agenda a visita de noiva).
      if (nlu.afirmativo || nlu.intencao === 'agendar_visita') {
        return {
          conversa: { ...base, estado: 'aguardando_pref_visita' },
          saidas: [texto(MSG.perguntaPreferenciaVisita)],
        };
      }
      // Sem aceite claro, reforça o convite à visita.
      return { conversa: base, saidas: [texto(MSG.conviteVisita)] };

    case 'aguardando_pref_visita':
      // Coletamos a preferência (se veio) e repassamos para a Raquel agendar.
      return {
        conversa: {
          ...base,
          estado: 'handoff',
          motivoHandoff: `visita da noiva${prefVisitaTexto(nlu)}`,
        },
        saidas: [texto(MSG.visitaVouRetornar)],
      };

    default:
      return { conversa: base, saidas: [] };
  }
}
