// Portas: contratos que isolam o núcleo de infraestrutura (WhatsApp, LLM,
// calendário, banco). Trocar de provedor = trocar o adapter, sem tocar no núcleo.

import type {
  Contato,
  Conversa,
  EntradaNLU,
  MensagemSaida,
  PreferenciaVisita,
} from '../domain/types';

/** Leitura da mensagem do lead (texto já transcrito, se veio de áudio). */
export interface NLU {
  /**
   * `historico`: turnos anteriores (mais antigo primeiro), para o modelo entender
   * o contexto desde a primeira mensagem, não só a frase atual. Opcional: sem ele,
   * a leitura ainda funciona (degrada para o comportamento antigo).
   */
  analisar(texto: string, conversa: Conversa, historico?: MensagemLog[]): Promise<EntradaNLU>;
}

/**
 * Redação humanizada de mensagens conversacionais (perguntas/convites). Reescreve
 * o texto-objetivo na voz da Raquel, respondendo saudação/small talk do cliente,
 * SEM inventar valores, datas ou condições. Só é chamado para saídas marcadas
 * como `humanizar`, que nunca contêm preço nem regra.
 */
export interface Redator {
  humanizar(entrada: {
    objetivo: string;
    mensagemCliente: string;
    /** A saudação já foi enviada nesta rajada (ex.: apresentação): não saudar de novo. */
    jaSaudou?: boolean;
    /**
     * Turnos anteriores (mais antigo primeiro). Deixa a abertura social soar
     * natural e contextual: responder um "tudo bem?", não repetir saudação já
     * feita, acolher quem pediu um minuto. Nunca muda o núcleo do OBJETIVO.
     */
    historico?: MensagemLog[];
    /** Nome da noiva, quando já sabido: o Redator pode usá-lo com naturalidade. */
    nome?: string;
  }): Promise<string>;
}

/** Canal de mensagens (WhatsApp em produção, Sandbox em teste). */
export interface MessagingProvider {
  enviar(telefone: string, saidas: MensagemSaida[]): Promise<void>;
  /**
   * Marca uma mensagem recebida como LIDA na Cloud API. Usado para controlar a
   * caixa da Raquel: conversa que o bot resolveu sozinho vira lida (some das
   * não lidas); a que precisa dela fica não lida. Best-effort: uma falha aqui
   * NUNCA deve derrubar o atendimento.
   */
  marcarLido(messageId: string): Promise<void>;
  /**
   * Mostra o indicador "digitando…" antes de o bot responder. Na Cloud API isso
   * vem junto do recibo de leitura, então TAMBÉM marca a mensagem como lida: por
   * isso só é usado quando o bot vai de fato responder (nunca em handoff, para a
   * conversa que precisa da Raquel continuar não lida). Best-effort.
   */
  mostrarDigitando(messageId: string): Promise<void>;
}

/** Disponibilidade de datas de evento (calendário dedicado, só livre/ocupado). */
export interface Calendario {
  verificar(dataISO: string): Promise<boolean>; // true = livre
  sugerirProxima(dataISO: string): Promise<string>;
}

/**
 * Agenda de visita de noiva (ADR-0005). Slots de horário, não dia inteiro.
 * Adapter plugável: Supabase agora, Google/Apple depois, sem tocar no núcleo.
 */
export interface AgendaVisita {
  /** Próximos horários livres ("YYYY-MM-DDTHH:mm"), filtrados pela preferência. */
  slotsLivres(opts: { aPartirDeISO: string; preferencia?: PreferenciaVisita; limite: number }): Promise<string[]>;
  /** Marca o horário de fato (escreve). Idempotente por slot. */
  marcar(slotISO: string, telefone: string, nome?: string): Promise<void>;
}

export interface ContatoRepository {
  buscarPorTelefone(telefone: string): Promise<Contato | null>;
  buscarPorNomeOuData(nome?: string, dataEvento?: string): Promise<Contato | null>;
}

export interface ConversaRepository {
  obter(telefone: string): Promise<Conversa | null>;
  salvar(conversa: Conversa): Promise<void>;
}

export type DirecaoMensagem = 'entrada' | 'saida';
export type TipoMensagemLog = 'texto' | 'pdf' | 'audio';

/** Uma mensagem do histórico (para dar contexto à leitura e à redação). */
export interface MensagemLog {
  direcao: DirecaoMensagem;
  tipo: TipoMensagemLog;
  conteudo: string;
  criadoEm: string;
}

/** Log de auditoria das mensagens trocadas (histórico por telefone). */
export interface MensagemRepo {
  registrar(
    telefone: string,
    direcao: DirecaoMensagem,
    tipo: TipoMensagemLog,
    conteudo: string,
  ): Promise<void>;
  /**
   * Últimas `limite` mensagens do telefone, em ordem cronológica (mais antiga
   * primeiro). Dá contexto à NLU e ao Redator: quem já saudou, o que já foi dito,
   * se a noiva perguntou "tudo bem?", etc. Best-effort; nunca deve derrubar o turno.
   */
  historico(telefone: string, limite: number): Promise<MensagemLog[]>;
  /**
   * Apaga o histórico do telefone. Usado pelo comando de teste `#reset`: sem isso,
   * a NLU/Redator releem os turnos antigos e ressuscitam dados já zerados (ex.: o
   * nome da noiva). Best-effort.
   */
  limpar(telefone: string): Promise<void>;
}

/** Avisa a Raquel que uma conversa precisa dela (Telegram/push em produção). */
export interface Notifier {
  alertarHandoff(conversa: Conversa, motivo: string): Promise<void>;
}

/** Transcrição de áudio (texto já pronto para a leitura do NLU). */
export interface Transcriber {
  transcrever(mediaId: string): Promise<string>;
}

/** Idempotência: a Meta reentrega webhooks; evita processar a mesma msg 2x. */
export interface EventStore {
  jaVisto(messageId: string): Promise<boolean>;
  marcar(messageId: string): Promise<void>;
}

export type TipoItemFila = 'texto' | 'audio';

export interface ItemFila {
  id: string;
  telefone: string;
  tipo: TipoItemFila;
  /** texto da mensagem, ou o mediaId quando tipo === 'audio'. */
  conteudo: string;
  processarApos: string; // ISO; implementa o delay proposital (~1min)
  /** id da mensagem na Cloud API (para marcá-la como lida no fim do turno). */
  mensagemId?: string;
}

/** Fila durável com delay (a resposta não é instantânea, para não parecer bot). */
export interface Fila {
  enfileirar(item: Omit<ItemFila, 'id'>): Promise<void>;
  pegarVencidas(agoraISO: string, limite: number): Promise<ItemFila[]>;
  marcarProcessado(id: string): Promise<void>;
}
