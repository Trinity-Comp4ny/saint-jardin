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

/** Avisa a Raquel que uma conversa precisa dela (Telegram/push em produção). */
export interface Notifier {
  alertarHandoff(conversa: Conversa, motivo: string): Promise<void>;
}
