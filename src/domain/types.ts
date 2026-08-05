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
  /**
   * A noiva pediu mini wedding em algum momento da conversa (não é dado do evento,
   * mas mora aqui para persistir entre turnos: o pedido pode vir antes dos dados).
   * Serve para explicar a regra do mini quando a escolha não se enquadra.
   */
  pediuMini?: boolean;
  /** Nome da noiva, quando ela se apresenta. Usado pelo Redator para personalizar. */
  nome?: string;
}

export type EstadoConversa =
  | 'novo'
  // Perguntamos o nome da noiva no primeiro contato e esperamos ela responder.
  | 'aguardando_nome'
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
  // A noiva recusou o convite ou se despediu: o bot agradece UMA vez e fica em
  // silêncio. Reabre sozinho se ela voltar com um pedido concreto (nova cotação,
  // visita ou dúvida). Evita o loop de re-convidar a cada "não".
  | 'encerrada'
  | 'handoff' // precisa da Raquel; bot fica em silêncio
  | 'humano'; // Raquel assumiu a conversa

export type StatusContato = 'lead' | 'fechado';

export type Intencao =
  | 'seguir_fluxo'
  | 'agendar_visita'
  | 'visita_tecnica' // fornecedor de casamento já fechado pedindo visita técnica
  | 'negociar'
  | 'fora_do_script'
  | 'cliente_fechado'
  // A pessoa se despede / encerra o assunto ("obrigada", "por enquanto é isso",
  // "depois eu vejo"): o bot agradece e para de puxar convite.
  | 'despedida'
  // Não é noiva buscando orçamento: fornecedor, parceria, imprensa ou afins que
  // precisa da Raquel. Não confundir com visita_tecnica (fornecedor de evento
  // fechado querendo agendar a visita técnica em si).
  | 'fornecedor';

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

export type TipoPdf = 'apresentacao' | 'proposta_2027' | 'proposta_2028' | 'proposta_mini';

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
  /**
   * Recusa/negação explícita a uma pergunta de sim/não ("não", "por enquanto
   * não", "agora não", "deixa pra depois", "vou pensar"). Distinto de `afirmativo`
   * ausente: aqui a pessoa disse NÃO de propósito, então o bot encerra em vez de
   * insistir no convite.
   */
  negativo?: boolean;
  /**
   * A pessoa pediu explicitamente por "mini wedding" / "micro wedding". Serve para
   * o bot explicar a regra (só dia de semana, até 80) quando o pedido não se
   * enquadra, em vez de mandar a proposta normal calada.
   */
  pediuMini?: boolean;
  /** Preferência de visita, quando a conversa está no fluxo de agendamento. */
  visita?: PreferenciaVisita;
  nomeDetectado?: string;
  dataEventoDetectada?: string;
}
