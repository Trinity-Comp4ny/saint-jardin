import { describe, expect, it } from 'vitest';
import { ingerirWebhook, processarFila } from '../src/app/pipeline';
import type { Deps } from '../src/app/orchestrator';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../src/adapters/memory';
import type { EventStore, Fila, ItemFila, NLU, Transcriber } from '../src/ports';
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
      async contarRecentes() {
        return 0;
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

describe('processarFila — economiza custo quando a conversa já está com a Raquel', () => {
  function itemAudio(id: string, telefone: string, mediaId: string): ItemFila {
    return { id, telefone, tipo: 'audio', conteudo: mediaId, processarApos: '2026-07-30T11:59:00.000Z' };
  }

  function transcriberEspiao(): { transcriber: Transcriber; chamadas: string[] } {
    const chamadas: string[] = [];
    return {
      chamadas,
      transcriber: {
        async transcrever(mediaId) {
          chamadas.push(mediaId);
          return 'texto transcrito';
        },
      },
    };
  }

  function conversaEm(telefone: string, estado: Conversa['estado']): Conversa {
    return {
      telefone,
      estado,
      slots: {},
      criadoEm: '2026-07-30T12:00:00.000Z',
      atualizadoEm: '2026-07-30T12:00:00.000Z',
    };
  }

  it('não transcreve áudio quando a conversa já está em handoff (regressão: rajada de áudio pós-handoff)', async () => {
    const { fila, processados } = filaCom([itemAudio('1', '5511999', 'media-abc')]);
    const { nlu, textos } = nluEspiao();
    const { transcriber, chamadas } = transcriberEspiao();
    const conversas = new InMemoryConversaRepo();
    await conversas.salvar(conversaEm('5511999', 'handoff'));
    const deps: Deps = { ...orquestrador(nlu), conversas };

    await processarFila({ fila, transcriber, orquestrador: deps });

    expect(chamadas).toHaveLength(0); // nem tentou transcrever
    expect(textos).toHaveLength(0); // NLU também não foi chamado
    expect(processados).toEqual(['1']); // item ainda é marcado como processado
  });

  it('não transcreve quando a conversa já está com humano (estado "humano")', async () => {
    const { fila } = filaCom([itemAudio('1', '5511999', 'media-abc')]);
    const { nlu } = nluEspiao();
    const { transcriber, chamadas } = transcriberEspiao();
    const conversas = new InMemoryConversaRepo();
    await conversas.salvar(conversaEm('5511999', 'humano'));
    const deps: Deps = { ...orquestrador(nlu), conversas };

    await processarFila({ fila, transcriber, orquestrador: deps });

    expect(chamadas).toHaveLength(0);
  });

  it('continua transcrevendo normalmente quando a conversa não está em handoff', async () => {
    const { fila } = filaCom([itemAudio('1', '5511999', 'media-abc')]);
    const { nlu, textos } = nluEspiao();
    const { transcriber, chamadas } = transcriberEspiao();

    await processarFila({ fila, transcriber, orquestrador: orquestrador(nlu) });

    expect(chamadas).toEqual(['media-abc']);
    expect(textos).toHaveLength(1);
  });
});

// Simula a atomicidade real do banco (constraint de unicidade em
// `eventos_processados`): `marcar` é o próprio check-and-set, sem `await`
// entre checar e gravar — nenhuma janela de corrida é possível aqui, do
// mesmo jeito que o INSERT do Postgres não deixa duas linhas com o mesmo
// message_id existirem, não importa a ordem de chegada.
function eventStoreVazio(): EventStore {
  const vistos = new Set<string>();
  return {
    async marcar(id) {
      if (vistos.has(id)) return false;
      vistos.add(id);
      return true;
    },
  };
}

function filaParaIngestao(contarRecentesRetorno = 0): {
  fila: Fila;
  enfileiradas: { telefone: string; conteudo: string }[];
} {
  const enfileiradas: { telefone: string; conteudo: string }[] = [];
  return {
    enfileiradas,
    fila: {
      async enfileirar(item) {
        enfileiradas.push({ telefone: item.telefone, conteudo: item.conteudo });
      },
      async pegarVencidas() {
        return [];
      },
      async marcarProcessado() {},
      async contarRecentes() {
        return contarRecentesRetorno;
      },
    },
  };
}

function webhookTexto(id: string, from: string, texto: string): unknown {
  return {
    entry: [
      { changes: [{ value: { messages: [{ id, from, type: 'text', text: { body: texto } }] } }] },
    ],
  };
}

describe('ingerirWebhook — rate limit por telefone (ADR-0009)', () => {
  it('enfileira normalmente quando está abaixo do limite', async () => {
    const { fila, enfileiradas } = filaParaIngestao(5);
    const n = await ingerirWebhook(webhookTexto('wamid.1', '5511999', 'oi'), {
      eventos: eventStoreVazio(),
      fila,
      agora: () => '2026-09-01T12:00:00.000Z',
      delaySegundos: 0,
    });
    expect(n).toBe(1);
    expect(enfileiradas).toHaveLength(1);
  });

  it('descarta a mensagem quando o telefone já bateu o limite na janela (default: 30/60min)', async () => {
    const { fila, enfileiradas } = filaParaIngestao(30);
    const eventos = eventStoreVazio();
    const n = await ingerirWebhook(webhookTexto('wamid.2', '5511999', 'spam'), {
      eventos,
      fila,
      agora: () => '2026-09-01T12:00:00.000Z',
      delaySegundos: 0,
    });
    expect(n).toBe(0);
    expect(enfileiradas).toHaveLength(0);
    // Idempotência continua registrada: a Meta não deve reentregar em loop.
    expect(await eventos.marcar('wamid.2')).toBe(false);
  });

  it('respeita um limite configurável (env RATE_LIMIT_MAX_MENSAGENS)', async () => {
    const { fila: filaNoLimite, enfileiradas: a } = filaParaIngestao(3);
    await ingerirWebhook(webhookTexto('wamid.3', '5511999', 'oi'), {
      eventos: eventStoreVazio(),
      fila: filaNoLimite,
      agora: () => '2026-09-01T12:00:00.000Z',
      delaySegundos: 0,
      limiteMensagens: 3,
    });
    expect(a).toHaveLength(0); // 3 recentes >= limite 3: descarta

    const { fila: filaAbaixo, enfileiradas: b } = filaParaIngestao(2);
    await ingerirWebhook(webhookTexto('wamid.4', '5511999', 'oi'), {
      eventos: eventStoreVazio(),
      fila: filaAbaixo,
      agora: () => '2026-09-01T12:00:00.000Z',
      delaySegundos: 0,
      limiteMensagens: 3,
    });
    expect(b).toHaveLength(1); // 2 recentes < limite 3: enfileira
  });
});

describe('processarFila — erro inesperado num telefone não pode derrubar o resto do lote', () => {
  it('telefones seguintes do mesmo lote continuam sendo processados mesmo se um telefone der erro', async () => {
    // Regressão séria: `pegarVencidas` reivindica TODOS os itens do lote de uma
    // vez (marca processado_em na hora de buscar). Se uma exceção escapasse do
    // loop de um telefone, os telefones seguintes do MESMO lote sumiriam pra
    // sempre — já contariam como processados, mas nunca teriam sido atendidos.
    const { fila, processados } = filaCom([
      item('1', '5511111', 'mensagem que aciona o bug'),
      item('2', '5522222', 'oi, tudo bem'),
    ]);
    const nluQuebrado: NLU = {
      async analisar(_texto, conversa) {
        if (conversa.telefone === '5511111') throw new Error('bug simulado');
        return { slots: {}, intencao: 'seguir_fluxo' };
      },
    };
    const messaging = new SandboxProvider();
    const notifier = new RecordingNotifier();
    const deps: Deps = { ...orquestrador(nluQuebrado), messaging, notifier };

    const turnos = await processarFila({ fila, transcriber: transcriberNoop, orquestrador: deps });

    expect(turnos).toBe(2);
    expect(processados).toEqual(['1', '2']); // nenhum item fica preso
    // telefone que quebrou: avisado e mandado pra handoff, não fica mudo
    expect(messaging.enviadas.find((e) => e.telefone === '5511111')?.saidas[0]?.texto).toBe(
      MSG.erroInesperado,
    );
    expect(
      notifier.alertas.some(
        (a) => a.telefone === '5511111' && a.motivo === 'erro inesperado no processamento',
      ),
    ).toBe(true);
    // telefone seguinte no mesmo lote: processado normalmente, não foi arrastado
    expect(messaging.enviadas.some((e) => e.telefone === '5522222')).toBe(true);
  });
});

describe('ingerirWebhook — dedup atômico sob concorrência real (regressão)', () => {
  it('duas chamadas CONCORRENTES (Promise.all, não sequencial) pro mesmo messageId enfileiram só uma vez', async () => {
    // Antes: `jaVisto` e `marcar` eram duas chamadas separadas (check-then-act).
    // Sob reentrega da Meta quase simultânea de verdade — não `await` sequencial,
    // que sempre resolveria a corrida por ordem de chamada — as duas podiam
    // passar pelo `jaVisto` antes de qualquer uma marcar, e a mensagem entrava
    // na fila 2x. Agora `marcar` é o próprio check-and-set atômico.
    const { fila, enfileiradas } = filaParaIngestao(0);
    const eventos = eventStoreVazio();
    const body = webhookTexto('wamid.concorrente', '5511999', 'oi');
    const deps = { eventos, fila, agora: () => '2026-09-01T12:00:00.000Z', delaySegundos: 0 };

    const [n1, n2] = await Promise.all([ingerirWebhook(body, deps), ingerirWebhook(body, deps)]);

    expect(n1 + n2).toBe(1); // só uma das duas chamadas concorrentes enfileirou
    expect(enfileiradas).toHaveLength(1);
  });
});
