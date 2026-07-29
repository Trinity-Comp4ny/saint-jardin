// Portas: contratos que isolam o núcleo de infraestrutura (WhatsApp, LLM,
// calendário, banco). Trocar de provedor = trocar o adapter, sem tocar no núcleo.

import type { Contato, Conversa, EntradaNLU, MensagemSaida } from '../domain/types';

/** Leitura da mensagem do lead (texto já transcrito, se veio de áudio). */
export interface NLU {
  analisar(texto: string, conversa: Conversa): Promise<EntradaNLU>;
}

/** Canal de mensagens (WhatsApp em produção, Sandbox em teste). */
export interface MessagingProvider {
  enviar(telefone: string, saidas: MensagemSaida[]): Promise<void>;
}

/** Disponibilidade de datas de evento (calendário dedicado, só livre/ocupado). */
export interface Calendario {
  verificar(dataISO: string): Promise<boolean>; // true = livre
  sugerirProxima(dataISO: string): Promise<string>;
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

/** Log de auditoria das mensagens trocadas (histórico por telefone). */
export interface MensagemRepo {
  registrar(
    telefone: string,
    direcao: DirecaoMensagem,
    tipo: TipoMensagemLog,
    conteudo: string,
  ): Promise<void>;
}

/** Avisa a Raquel que uma conversa precisa dela (Telegram/push em produção). */
export interface Notifier {
  alertarHandoff(conversa: Conversa, motivo: string): Promise<void>;
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
}

/** Fila durável com delay (a resposta não é instantânea, para não parecer bot). */
export interface Fila {
  enfileirar(item: Omit<ItemFila, 'id'>): Promise<void>;
  pegarVencidas(agoraISO: string, limite: number): Promise<ItemFila[]>;
  marcarProcessado(id: string): Promise<void>;
}
