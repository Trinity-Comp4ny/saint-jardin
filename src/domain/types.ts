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
  /**
   * Texto natural do dia/horário CONCRETO que a noiva propôs para a visita (ex.:
   * "dia 12 às 10h", "sábado 09/08 de manhã"). Só quando ela dá uma data específica,
   * não uma preferência genérica ("domingo de manhã"). O bot repassa isso à Raquel.
   */
  dataHora?: string;
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
  /** Nome da noiva, quando ela se apresenta. Usado pelo Redator para personalizar. */
  nome?: string;
  /**
   * Controle interno (NUNCA vem da NLU): última data que o bot já avisou estar
   * ocupada. Permite tratar o "pode ser" do turno seguinte como aceite da
   * alternativa oferecida — sem o aviso prévio, um afirmativo solto não adota
   * data nenhuma.
   */
  dataOcupadaAvisada?: string;
  /**
   * Controle interno (NUNCA vem da NLU): a pessoa recusou o mini wedding e aceitou
   * receber as propostas tradicionais. Sem isso, um dia de semana com até 80
   * convidados cairia de novo na oferta do mini a cada re-qualificação.
   */
  tradicionalAceito?: boolean;
  /**
   * Visita técnica (fornecedor de casamento já fechado). Campos PRÓPRIOS, separados da data
   * do evento de orçamento (`data`, `ano`...): o fornecedor fala de duas datas, a do casamento
   * que ele atende e a da visita que ele quer, e antes elas se misturavam.
   */
  /** Data que o fornecedor pediu para a visita, ISO (YYYY-MM-DD). Só depois de validada. */
  dataVisitaTecnica?: string;
  /** Data do casamento que ele atende: ISO, ou "MM-DD" se ele não disse o ano. */
  dataCasamento?: string;
  /** Nome dos noivos do casamento que ele atende ("Ana e Pedro"). */
  casamentoNoivos?: string;
  /** O que ele presta ("buffet", "decoração", "fotografia"). */
  fornecedorServico?: string;
  /**
   * Controle interno (NUNCA vem da NLU): a pessoa pediu um ano que ainda não vendemos (2029) e o
   * bot já avisou e usou 2028 como base. Evita repetir o aviso e mostra à Raquel o ano pedido.
   */
  anoSolicitado?: number;
}

export type EstadoConversa =
  | 'novo'
  // A primeira mensagem foi só um cumprimento: o bot perguntou "como posso
  // ajudar?" e espera a pessoa dizer o assunto antes de iniciar o fluxo comercial.
  | 'aguardando_assunto'
  | 'aguardando_qualificacao'
  | 'aguardando_interesse_mini'
  // A pessoa recusou o mini: o bot perguntou se pode mandar as propostas tradicionais.
  | 'aguardando_aceite_tradicional'
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
  // A mensagem é SÓ um cumprimento ("oi", "bom dia"), sem pedido, pergunta nem dado.
  // Só faz sentido no primeiro contato: o bot não inicia o fluxo comercial ainda.
  | 'saudacao'
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
  /** Última vez que a PESSOA escreveu (o bot atualiza a cada turno processado). */
  ultimaEntradaEm?: string;
  /** Quando a proposta (PDF) foi enviada. Base do follow-up de 12h. */
  propostaEnviadaEm?: string;
  /** Quando o follow-up foi enviado (uma vez por proposta). */
  followupEnviadoEm?: string;
  /**
   * Quando o convite de visita pós-proposta foi enviado (uma vez por proposta). Ausente depois de
   * uma proposta = ainda pendente: sai 5 minutos depois do PDF ou na próxima resposta da pessoa.
   */
  conviteEnviadoEm?: string;
}

export type TipoPdf = 'proposta_2027' | 'proposta_2028' | 'proposta_mini';
export type TipoVideo = 'apresentacao';

export interface MensagemSaida {
  tipo: 'texto' | 'pdf' | 'video';
  texto?: string;
  pdf?: TipoPdf;
  video?: TipoVideo;
  /**
   * Só para textos conversacionais (perguntas, convites): a camada de redação
   * pode reescrever numa voz mais humana, respondendo saudação/small talk. NUNCA
   * marcado em mensagens com preço, proposta ou regra (essas vão literais).
   */
  humanizar?: boolean;
}

/** Dúvidas que o bot responde com texto pronto da Raquel, sem passar por handoff. */
export type Duvida = 'hospedagem' | 'pacotes' | 'valores';

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
   * A pessoa não decidiu nem recusou: "vou pensar", "vou ver com meu noivo",
   * "preciso conversar". Distinto de `negativo`: na oferta do mini, quem está
   * indeciso recebe o PDF, quem recusa recebe a pergunta das propostas tradicionais.
   */
  indeciso?: boolean;
  /**
   * A pessoa pediu um ano que a agenda ainda não abriu (hoje 2029). Detectado por regra, não pelo
   * modelo: o schema de `slots.ano` só aceita 2027 e 2028 e descartava o resto em silêncio.
   */
  anoIndisponivel?: number;
  /**
   * Dúvidas frequentes citadas na mensagem (hospedagem, pacotes fechados, valores). Detectadas por
   * regra, não pelo modelo: o modelo chamava "vocês têm hospedagem?" de fora_do_script e a
   * conversa caía em handoff mudo.
   */
  duvidas?: Duvida[];
  /**
   * Visita técnica: o casamento que o fornecedor atende (data, noivos e o serviço dele).
   * Separado de `slots`, onde ficam só os dados de orçamento e a data da PRÓPRIA visita.
   */
  casamentoAtendido?: { data?: string; noivos?: string; servico?: string };
  /** Preferência de visita, quando a conversa está no fluxo de agendamento. */
  visita?: PreferenciaVisita;
  nomeDetectado?: string;
  dataEventoDetectada?: string;
}
