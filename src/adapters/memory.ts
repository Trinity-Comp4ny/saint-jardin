// Adapters em memória para sandbox e testes: canal, repositórios e notifier.
// Eles apenas registram dados; a impressão fica a cargo de quem consome
// (o CLI do sandbox), mantendo os adapters livres de I/O de console.

import type {
  Calendario,
  ContatoRepository,
  ConversaRepository,
  DirecaoMensagem,
  MensagemLog,
  MensagemRepo,
  MessagingProvider,
  Notifier,
  TipoMensagemLog,
} from '../ports';
import type { Contato, Conversa, MensagemSaida } from '../domain/types';

export class SandboxProvider implements MessagingProvider {
  public enviadas: { telefone: string; saidas: MensagemSaida[] }[] = [];
  public lidas: string[] = [];
  public digitando: string[] = [];

  async enviar(telefone: string, saidas: MensagemSaida[]): Promise<void> {
    this.enviadas.push({ telefone, saidas });
  }

  async marcarLido(messageId: string): Promise<void> {
    this.lidas.push(messageId);
  }

  async mostrarDigitando(messageId: string): Promise<void> {
    // Typing = read na Cloud API, então registra nos dois (a caixa vira lida).
    this.digitando.push(messageId);
    this.lidas.push(messageId);
  }
}

export class InMemoryContatoRepo implements ContatoRepository {
  private porTelefone = new Map<string, Contato>();

  constructor(seed: Contato[] = []) {
    for (const c of seed) this.porTelefone.set(c.telefone, c);
  }

  async buscarPorTelefone(telefone: string): Promise<Contato | null> {
    return this.porTelefone.get(telefone) ?? null;
  }

  async buscarPorNomeOuData(nome?: string, dataEvento?: string): Promise<Contato | null> {
    for (const c of this.porTelefone.values()) {
      if (nome && c.nome && c.nome.toLowerCase() === nome.toLowerCase()) return c;
      if (dataEvento && c.dataEvento === dataEvento) return c;
    }
    return null;
  }
}

export class InMemoryConversaRepo implements ConversaRepository {
  private mapa = new Map<string, Conversa>();

  async obter(telefone: string): Promise<Conversa | null> {
    return this.mapa.get(telefone) ?? null;
  }

  async salvar(conversa: Conversa): Promise<void> {
    this.mapa.set(conversa.telefone, conversa);
  }
}

export class MockCalendario implements Calendario {
  constructor(private readonly ocupadas: Set<string> = new Set()) {}

  async verificar(dataISO: string): Promise<boolean> {
    return !this.ocupadas.has(dataISO);
  }

  async sugerirProxima(dataISO: string): Promise<string> {
    // Próxima data (mesmo dia da semana) livre, andando de 7 em 7 dias.
    const d = new Date(`${dataISO}T12:00:00`);
    for (let i = 1; i <= 12; i++) {
      d.setUTCDate(d.getUTCDate() + 7);
      const iso = d.toISOString().slice(0, 10);
      if (!this.ocupadas.has(iso)) return iso;
    }
    return dataISO;
  }
}

export class InMemoryMensagemRepo implements MensagemRepo {
  // Contador só para manter a ordem cronológica de forma estável nos testes
  // (não usamos relógio real aqui).
  private seq = 0;
  private porTelefone = new Map<string, MensagemLog[]>();

  async registrar(
    telefone: string,
    direcao: DirecaoMensagem,
    tipo: TipoMensagemLog,
    conteudo: string,
  ): Promise<void> {
    const arr = this.porTelefone.get(telefone) ?? [];
    arr.push({ direcao, tipo, conteudo, criadoEm: String(this.seq++).padStart(6, '0') });
    this.porTelefone.set(telefone, arr);
  }

  async historico(telefone: string, limite: number): Promise<MensagemLog[]> {
    const arr = this.porTelefone.get(telefone) ?? [];
    return arr.slice(-limite);
  }

  async limpar(telefone: string): Promise<void> {
    this.porTelefone.delete(telefone);
  }
}

export class RecordingNotifier implements Notifier {
  public alertas: { telefone: string; motivo: string }[] = [];

  async alertarHandoff(conversa: Conversa, motivo: string): Promise<void> {
    this.alertas.push({ telefone: conversa.telefone, motivo });
  }
}
