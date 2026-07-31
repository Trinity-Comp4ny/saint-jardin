// Tipos do domínio do atendimento. Sem dependências externas: é o coração testável.

export type DiaSemana =
  | 'segunda'
  | 'terca'
  | 'quarta'
  | 'quinta'
  | 'sexta'
  | 'sabado'
  | 'domingo';

/** Dias com valor cheio (mesmo PDF): sexta, sábado e domingo. */
export const DIAS_VALOR_CHEIO: DiaSemana[] = ['sexta', 'sabado', 'domingo'];
/** Dias de semana que caem em mini wedding: segunda a quinta. */
export const DIAS_DE_SEMANA: DiaSemana[] = ['segunda', 'terca', 'quarta', 'quinta'];

/** Limite abaixo do qual o evento vira mini wedding. */
export const LIMITE_MINI_WEDDING = 80;

export type Ano = 2027 | 2028;
export const ANOS_DISPONIVEIS: Ano[] = [2027, 2028];

export type PreferenciaDia = 'fim_de_semana' | 'dia_de_semana';

export type PeriodoVisita = 'manha' | 'tarde';

/** Preferência da noiva para a visita, extraída pela NLU no fluxo de agendamento. */
export interface PreferenciaVisita {
  diaSemana?: DiaSemana;
  periodo?: PeriodoVisita;
  /** "tanto faz" / "qualquer dia": deixa o bot propor o próximo horário livre. */
  indiferente?: boolean;
}

export interface Slots {
  /** Data do evento em ISO (yyyy-mm-dd), quando informada com precisão (dia, mês e ano). */
  data?: string;
  /** Dia e mês sem ano (formato "MM-DD"), quando a noiva diz "26 de janeiro" sem citar o ano. */
  mesDia?: string;
  /** Dia do mês (1-31) informado sozinho, para combinar com `mes` de outro turno. */
  dia?: number;
  /** Mês (1-12) informado sozinho, para combinar com `dia` de outro turno. */
  mes?: number;
  ano?: Ano;
  diaSemana?: DiaSemana;
  /** Preferência genérica quando o dia exato não foi dado ("fim de semana" / "dia de semana"). */
  preferenciaDia?: PreferenciaDia;
  convidados?: number;
}

export type EstadoConversa =
  | 'novo'
  | 'aguardando_qualificacao'
  | 'aguardando_interesse_mini'
  // dia de semana com mais de 80 convidados: explicamos que não cabe no mini e
  // esperamos a noiva confirmar que quer receber a proposta normal.
  | 'aguardando_confirmacao_normal'
  // Confirmou a proposta normal (dia de semana > 80): agora só coletar data/ano.
  | 'aguardando_data_normal'
  | 'proposta_enviada'
  // Visita (ADR-0005 rev. 30/07): o bot coleta e repassa; não marca.
  | 'aguardando_pref_visita' // noiva aceitou; coletando dia de preferência
  | 'visita_tecnica_data' // fornecedor pediu visita técnica; coletando/validando a data
  | 'handoff' // precisa da Raquel; bot fica em silêncio
  | 'humano'; // Raquel assumiu a conversa

export type StatusContato = 'lead' | 'fechado';

export type Intencao =
  | 'seguir_fluxo'
  | 'agendar_visita'
  | 'visita_tecnica' // fornecedor de casamento já fechado pedindo visita técnica
  | 'negociar'
  | 'fora_do_script'
  | 'cliente_fechado';

export interface Contato {
  telefone: string;
  nome?: string;
  status: StatusContato;
  /** Data do evento, para casar cliente já fechado que escreve de número novo. */
  dataEvento?: string;
}

export interface Conversa {
  telefone: string;
  estado: EstadoConversa;
  slots: Slots;
  motivoHandoff?: string;
  criadoEm: string;
  atualizadoEm: string;
}

export type TipoPdf = 'apresentacao' | 'proposta_2027' | 'proposta_2028';

export interface MensagemSaida {
  tipo: 'texto' | 'pdf';
  texto?: string;
  pdf?: TipoPdf;
  /**
   * Só para textos conversacionais (perguntas, convites): a camada de redação
   * pode reescrever numa voz mais humana, respondendo saudação/small talk. NUNCA
   * marcado em mensagens com preço, proposta ou regra (essas vão literais).
   */
  humanizar?: boolean;
}

/** Resultado da leitura da mensagem do lead pela camada de NLU. */
export interface EntradaNLU {
  slots: Slots;
  intencao: Intencao;
  /** Sinaliza resposta afirmativa (para a oferta de mini wedding, por ex.). */
  afirmativo?: boolean;
  /** Preferência de visita, quando a conversa está no fluxo de agendamento. */
  visita?: PreferenciaVisita;
  nomeDetectado?: string;
  dataEventoDetectada?: string;
}
