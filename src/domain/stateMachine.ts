// Máquina de estados determinística da conversa.
// É uma função PURA: mesmas entradas -> mesmas saídas. O LLM fica FORA daqui
// (a leitura da mensagem chega pronta em EntradaNLU), o que torna cada ramo
// testável sem chamar Claude nem WhatsApp.

import {
  DIAS_DE_SEMANA,
  LIMITE_MINI_WEDDING,
  type Conversa,
  type EntradaNLU,
  type MensagemSaida,
  type PreferenciaDia,
  type Slots,
} from './types';
import { MSG } from './persona';
import { pdfPropostaPorAno } from './pdfs';

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

/** Regra de negócio: quando o evento cai em mini wedding. */
export function ehMiniWedding(slots: Slots): boolean {
  const dia = classificarDia(slots);
  const poucosConvidados =
    slots.convidados !== undefined && slots.convidados < LIMITE_MINI_WEDDING;
  return dia === 'dia_de_semana' || poucosConvidados;
}

function mesclarSlots(atual: Slots, novo: Slots): Slots {
  return {
    data: novo.data ?? atual.data,
    ano: novo.ano ?? atual.ano,
    diaSemana: novo.diaSemana ?? atual.diaSemana,
    preferenciaDia: novo.preferenciaDia ?? atual.preferenciaDia,
    convidados: novo.convidados ?? atual.convidados,
  };
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

  // Intenções que exigem humano têm prioridade, exceto na primeira saudação
  // (queremos ao menos apresentar o espaço antes de transbordar).
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

      // Evento normal: precisa do ano para escolher o PDF.
      if (!slots.ano) {
        return { conversa: base, saidas: [texto(MSG.perguntaAno)] };
      }

      // Se o lead deu uma data específica e ela está ocupada, sugere alternativa.
      const disp = ctx.disponibilidadeData;
      if (disp && disp.data === slots.data && !disp.livre) {
        return {
          conversa: base,
          saidas: [texto(MSG.dataIndisponivel(disp.data, disp.alternativa ?? 'outra data'))],
        };
      }

      return {
        conversa: { ...base, estado: 'proposta_enviada' },
        saidas: [
          texto(MSG.orcamentoNormal),
          { tipo: 'pdf', pdf: pdfPropostaPorAno(slots.ano) },
          texto(MSG.conviteVisita),
        ],
      };
    }

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
      // Orçamento já foi. Qualquer avanço real (visita, negociação) já caiu no
      // handoff acima. Aqui só reforçamos o convite à visita.
      return { conversa: base, saidas: [texto(MSG.conviteVisita)] };

    default:
      return { conversa: base, saidas: [] };
  }
}
