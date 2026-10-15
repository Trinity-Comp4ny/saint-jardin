import { beforeEach, describe, expect, it } from 'vitest';
import { MockNLU } from '../src/adapters/MockNLU';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  InMemoryMensagemRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../src/adapters/memory';
import { processarMensagem, type Deps } from '../src/app/orchestrator';
import type { Conversa, EntradaNLU, MensagemSaida } from '../src/domain/types';
import type { MensagemLog, NLU } from '../src/ports';

const NOIVA = '5511988887777';
let deps: Deps;
let messaging: SandboxProvider;
let notifier: RecordingNotifier;

function todasSaidas(): MensagemSaida[] {
  return messaging.enviadas.flatMap((e) => e.saidas);
}

beforeEach(() => {
  messaging = new SandboxProvider();
  notifier = new RecordingNotifier();
  deps = {
    contatos: new InMemoryContatoRepo([
      { telefone: '5511999990000', nome: 'Bruna Torelli', status: 'fechado', dataEvento: '21/08' },
    ]),
    conversas: new InMemoryConversaRepo(),
    nlu: new MockNLU(),
    calendario: new MockCalendario(new Set(['2027-10-09'])),
    messaging,
    notifier,
    agora: () => '2026-07-21T12:00:00.000Z',
  };
});

describe('conversa completa pelo orquestrador', () => {
  it('leva uma noiva de sábado/2027/200 até a proposta enviada', async () => {
    await processarMensagem(NOIVA, 'Oi, quero um orçamento', deps);
    await processarMensagem(NOIVA, 'penso em um sábado', deps);
    const r = await processarMensagem(NOIVA, 'umas 200 pessoas em 2027', deps);

    expect(r.conversa.estado).toBe('proposta_enviada');
    // Vídeo de apresentação na abertura e o PDF do ano na proposta.
    expect(todasSaidas().filter((s) => s.tipo === 'video').map((v) => v.video)).toEqual(['apresentacao']);
    const pdfs = todasSaidas().filter((s) => s.tipo === 'pdf');
    expect(pdfs.map((p) => p.pdf)).toEqual(['proposta_2027']);
    // A proposta marca o início do follow-up de 12h.
    expect(r.conversa.propostaEnviadaEm).toBe('2026-07-21T12:00:00.000Z');
  });

  it('extrai convidados e ano de uma data completa dd/mm/yyyy', async () => {
    await processarMensagem(NOIVA, 'oi quero orçamento', deps);
    // 09/10/2027 cai num sábado; data está ocupada -> sugere alternativa
    const r = await processarMensagem(NOIVA, 'quero dia 09/10/2027, 150 convidados', deps);
    expect(r.conversa.slots.ano).toBe(2027);
    expect(r.conversa.slots.convidados).toBe(150);
    expect(todasSaidas().at(-1)?.texto).toMatch(/reservada/);
  });
});

describe('primeira mensagem: cumprimento antes do pedido', () => {
  it('"oi" sozinho: pergunta como pode ajudar, sem vídeo; o pedido de orçamento inicia o fluxo', async () => {
    const r1 = await processarMensagem(NOIVA, 'Oi, tudo bem?', deps);
    expect(r1.conversa.estado).toBe('aguardando_assunto');
    expect(r1.saidas.map((s) => s.texto)).toEqual([
      'Olá, tudo bem? O Saint Jardin Eventos agradece seu contato. Como posso ajudar?',
    ]);

    const r2 = await processarMensagem(NOIVA, 'queria saber os valores para casamento', deps);
    expect(r2.conversa.estado).toBe('aguardando_qualificacao');
    expect(r2.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto']);
  });

  it('"bom dia" seguido de uma dúvida que não é orçamento vai para a Raquel sem vídeo', async () => {
    await processarMensagem(NOIVA, 'Bom dia', deps);
    // "sou cliente de vocês": o MockNLU lê como cliente fechado -> silêncio e handoff
    const r = await processarMensagem(NOIVA, 'sou cliente de vocês, queria ver uma coisa', deps);
    expect(r.conversa.estado).toBe('handoff');
    expect(todasSaidas().some((s) => s.tipo === 'video')).toBe(false);
  });
});

describe('identificação de cliente fechado', () => {
  it('não atende número de cliente já fechado e alerta a Raquel', async () => {
    const r = await processarMensagem('5511999990000', 'oi, dúvida do contrato', deps);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas).toHaveLength(0);
    expect(todasSaidas()).toHaveLength(0);
    expect(notifier.alertas).toHaveLength(1);
  });

  it('casa cliente fechado que escreve de número novo pela data do evento', async () => {
    const r = await processarMensagem(
      '5511000001111',
      'oi sou a noiva do dia 21/08, queria ver uma coisa',
      deps,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(notifier.alertas).toHaveLength(1);
  });
});

describe('comando de reset (modo teste)', () => {
  it('zera a conversa quando vem de um número de teste', async () => {
    deps.numerosTeste = [NOIVA];
    await processarMensagem(NOIVA, 'penso em um sábado, 200 pessoas 2027', deps);
    const r = await processarMensagem(NOIVA, '#reset', deps);

    expect(r.conversa.estado).toBe('novo');
    expect(r.conversa.slots).toEqual({});
    expect(todasSaidas().at(-1)?.texto).toMatch(/zerada/i);
  });

  it('ignora o comando quando o número não está em modo teste', async () => {
    // Sem numerosTeste: "#reset" é tratado como mensagem comum, não reseta.
    const r = await processarMensagem(NOIVA, '#reset', deps);
    expect(r.conversa.estado).not.toBe('novo');
  });

  it('reseta mesmo quando o #reset vem junto de outra linha no mesmo lote', async () => {
    // A fila agrupa a rajada com "\n"; antes, "#reser\n#reset" não batia com o
    // comando e o bot respondia contra o estado velho. Agora reseta por linha.
    deps.numerosTeste = [NOIVA];
    await processarMensagem(NOIVA, 'penso em um sábado, 200 pessoas 2027', deps);
    const r = await processarMensagem(NOIVA, '#reser\n#reset', deps);
    expect(r.conversa.estado).toBe('novo');
    expect(r.conversa.slots).toEqual({});
  });

  it('o #reset apaga o histórico (o nome da noiva não ressuscita depois)', async () => {
    deps.numerosTeste = [NOIVA];
    const mensagens = new InMemoryMensagemRepo();
    deps.mensagens = mensagens;

    await processarMensagem(NOIVA, 'Oi, me chamo Ester', deps);
    expect((await mensagens.historico(NOIVA, 20)).length).toBeGreaterThan(0);

    await processarMensagem(NOIVA, '#reset', deps);
    // Sem histórico, a NLU não tem como reler o "Ester" antigo no próximo turno.
    expect(await mensagens.historico(NOIVA, 20)).toEqual([]);
  });

  it('o #reset ARQUIVA o histórico: some do contexto, mas a conversa de teste fica disponível', async () => {
    deps.numerosTeste = [NOIVA];
    const mensagens = new InMemoryMensagemRepo();
    deps.mensagens = mensagens;

    await processarMensagem(NOIVA, 'Oi, me chamo Ester', deps);
    const antes = (await mensagens.historico(NOIVA, 20)).map((m) => m.conteudo);
    expect(antes.length).toBeGreaterThan(0);

    await processarMensagem(NOIVA, '#reset', deps);
    expect(await mensagens.historico(NOIVA, 20)).toEqual([]);
    // O arquivo guarda tudo que havia, inclusive a própria linha do #reset.
    expect(mensagens.arquivadas.get(NOIVA)?.map((m) => m.conteudo)).toEqual([...antes, '#reset']);
  });
});

describe('contexto: histórico chega à NLU', () => {
  it('passa os turnos anteriores (mais antigo primeiro) e não inclui a mensagem atual', async () => {
    // NLU espiã: registra o histórico recebido em cada chamada.
    const capturado: MensagemLog[][] = [];
    const espia: NLU = {
      async analisar(_texto: string, _conversa: Conversa, historico?: MensagemLog[]): Promise<EntradaNLU> {
        capturado.push(historico ?? []);
        return { slots: {}, intencao: 'seguir_fluxo' };
      },
    };
    deps.nlu = espia;
    deps.mensagens = new InMemoryMensagemRepo();

    await processarMensagem(NOIVA, 'Oi, tudo bem?', deps);
    await processarMensagem(NOIVA, 'quero um orçamento', deps);

    // 1ª chamada: sem histórico. 2ª: vê a 1ª mensagem da noiva e a resposta do bot,
    // mas ainda NÃO a mensagem atual ("quero um orçamento").
    expect(capturado[0]).toEqual([]);
    const segundo = capturado[1] ?? [];
    expect(segundo.some((m) => m.direcao === 'entrada' && m.conteudo === 'Oi, tudo bem?')).toBe(true);
    expect(segundo.some((m) => m.conteudo === 'quero um orçamento')).toBe(false);
  });
});

describe('bot silencioso após handoff', () => {
  it('não responde mais depois que a conversa vira handoff/humano', async () => {
    await processarMensagem('5511999990000', 'oi', deps); // vira handoff
    const antes = todasSaidas().length;
    const r = await processarMensagem('5511999990000', 'mais uma coisa', deps);
    expect(r.saidas).toHaveLength(0);
    expect(todasSaidas().length).toBe(antes);
  });
});
