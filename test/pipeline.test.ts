import { describe, expect, it } from 'vitest';
import { processarFila } from '../src/app/pipeline';
import type { Deps } from '../src/app/orchestrator';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../src/adapters/memory';
import type { Fila, ItemFila, NLU, Transcriber } from '../src/ports';
import type { Conversa, EntradaNLU } from '../src/domain/types';
import { MSG } from '../src/domain/persona';

function filaCom(itens: ItemFila[]): { fila: Fila; processados: string[] } {
  const processados: string[] = [];
  return {
    processados,
    fila: {
      async enfileirar() {},
      async pegarVencidas() {
        return itens;
      },
      async marcarProcessado(id) {
        processados.push(id);
      },
    },
  };
}

// NLU espião: registra cada texto recebido.
function nluEspiao(): { nlu: NLU; textos: string[] } {
  const textos: string[] = [];
  return {
    textos,
    nlu: {
      async analisar(texto: string, _c: Conversa): Promise<EntradaNLU> {
        textos.push(texto);
        return { slots: {}, intencao: 'seguir_fluxo' };
      },
    },
  };
}

const transcriberNoop: Transcriber = { async transcrever() { return ''; } };

function orquestrador(nlu: NLU): Deps {
  return {
    contatos: new InMemoryContatoRepo(),
    conversas: new InMemoryConversaRepo(),
    nlu,
    calendario: new MockCalendario(),
    messaging: new SandboxProvider(),
    notifier: new RecordingNotifier(),
    agora: () => '2026-07-30T12:00:00.000Z',
  };
}

function item(id: string, telefone: string, conteudo: string, mensagemId?: string): ItemFila {
  return {
    id,
    telefone,
    tipo: 'texto',
    conteudo,
    processarApos: '2026-07-30T11:59:00.000Z',
    ...(mensagemId ? { mensagemId } : {}),
  };
}

describe('processarFila — agrupamento de rajada', () => {
  it('junta as mensagens do mesmo telefone num único turno', async () => {
    const { fila, processados } = filaCom([
      item('1', '5511999', 'Boa tarde'),
      item('2', '5511999', 'tudo bem?'),
      item('3', '5511999', 'vou passar as infos'),
    ]);
    const { nlu, textos } = nluEspiao();

    const turnos = await processarFila({ fila, transcriber: transcriberNoop, orquestrador: orquestrador(nlu) });

    expect(turnos).toBe(1); // um telefone = um turno
    expect(textos).toHaveLength(1); // NLU chamado uma vez
    expect(textos[0]).toBe('Boa tarde\ntudo bem?\nvou passar as infos'); // textos concatenados
    expect(processados).toEqual(['1', '2', '3']); // todos os itens marcados
  });

  it('telefones diferentes são turnos separados', async () => {
    const { fila } = filaCom([item('1', '5511111', 'oi'), item('2', '5522222', 'olá')]);
    const { nlu, textos } = nluEspiao();

    const turnos = await processarFila({ fila, transcriber: transcriberNoop, orquestrador: orquestrador(nlu) });

    expect(turnos).toBe(2);
    expect(textos).toHaveLength(2);
  });
});

describe('processarFila — lida/não-lida na caixa da Raquel', () => {
  it('marca a última mensagem do turno como lida quando o bot resolve sozinho', async () => {
    const { fila } = filaCom([
      item('1', '5511999', 'oi', 'wamid.A'),
      item('2', '5511999', 'quero orçamento', 'wamid.B'),
    ]);
    const { nlu } = nluEspiao();
    const messaging = new SandboxProvider();
    const deps: Deps = { ...orquestrador(nlu), messaging };

    await processarFila({ fila, transcriber: transcriberNoop, orquestrador: deps });

    // Só o id da última mensagem da rajada é marcado (marca tudo até ele).
    expect(messaging.lidas).toEqual(['wamid.B']);
  });

  it('deixa não lida quando a conversa vira handoff (precisa da Raquel)', async () => {
    const { fila } = filaCom([item('1', '5511999990000', 'oi, dúvida', 'wamid.C')]);
    const { nlu } = nluEspiao();
    const messaging = new SandboxProvider();
    const deps: Deps = {
      ...orquestrador(nlu),
      messaging,
      // Cliente já fechado por número: o orquestrador transborda para handoff.
      contatos: new InMemoryContatoRepo([
        { telefone: '5511999990000', status: 'fechado' },
      ]),
    };

    await processarFila({ fila, transcriber: transcriberNoop, orquestrador: deps });

    expect(messaging.lidas).toEqual([]);
    expect(messaging.digitando).toEqual([]);
  });

  it('mostra "digitando" na última mensagem quando o bot vai responder', async () => {
    const { fila } = filaCom([
      item('1', '5511999', 'oi', 'wamid.A'),
      item('2', '5511999', 'quero orçamento', 'wamid.B'),
    ]);
    const { nlu } = nluEspiao();
    const messaging = new SandboxProvider();
    const deps: Deps = { ...orquestrador(nlu), messaging };

    await processarFila({ fila, transcriber: transcriberNoop, orquestrador: deps });

    // Digita antes de responder (e isso já marca lido) no id da última da rajada.
    expect(messaging.digitando).toEqual(['wamid.B']);
    expect(messaging.enviadas.length).toBeGreaterThan(0);
  });

  it('não mostra "digitando" no handoff (conversa fica não lida)', async () => {
    const { fila } = filaCom([item('1', '5511999990000', 'oi, dúvida', 'wamid.C')]);
    const { nlu } = nluEspiao();
    const messaging = new SandboxProvider();
    const deps: Deps = {
      ...orquestrador(nlu),
      messaging,
      contatos: new InMemoryContatoRepo([{ telefone: '5511999990000', status: 'fechado' }]),
    };

    await processarFila({ fila, transcriber: transcriberNoop, orquestrador: deps });

    expect(messaging.digitando).toEqual([]);
  });
});

describe('processarFila — falha ao transcrever áudio', () => {
  function itemAudio(id: string, telefone: string, mediaId: string, mensagemId?: string): ItemFila {
    return {
      id,
      telefone,
      tipo: 'audio',
      conteudo: mediaId,
      processarApos: '2026-07-30T11:59:00.000Z',
      ...(mensagemId ? { mensagemId } : {}),
    };
  }

  const transcriberQuebrado: Transcriber = {
    async transcrever() {
      throw new Error('Gemini 401: chave inválida');
    },
  };

  it('avisa a noiva, dispara handoff e não perde a mensagem silenciosamente', async () => {
    const { fila, processados } = filaCom([itemAudio('1', '5511999', 'media-abc', 'wamid.A')]);
    const { nlu, textos } = nluEspiao();
    const messaging = new SandboxProvider();
    const notifier = new RecordingNotifier();
    const deps: Deps = { ...orquestrador(nlu), messaging, notifier };

    await processarFila({ fila, transcriber: transcriberQuebrado, orquestrador: deps });

    expect(textos).toHaveLength(0); // NLU nunca chamado com contexto incompleto
    expect(messaging.enviadas).toHaveLength(1);
    expect(messaging.enviadas[0]?.saidas[0]?.texto).toBe(MSG.audioNaoEntendido);
    expect(notifier.alertas).toEqual([
      { telefone: '5511999', motivo: 'áudio recebido, mas a transcrição falhou' },
    ]);
    expect(processados).toEqual(['1']); // item ainda é marcado como processado
  });

  it('mesmo com falha, a conversa é persistida em handoff (bot para de responder)', async () => {
    const { fila } = filaCom([itemAudio('1', '5511999', 'media-abc')]);
    const { nlu } = nluEspiao();
    const conversas = new InMemoryConversaRepo();
    const deps: Deps = { ...orquestrador(nlu), conversas };

    await processarFila({ fila, transcriber: transcriberQuebrado, orquestrador: deps });

    const conversa = await conversas.obter('5511999');
    expect(conversa?.estado).toBe('handoff');
  });
});
