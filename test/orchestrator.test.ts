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
    const pdfs = todasSaidas().filter((s) => s.tipo === 'pdf');
    expect(pdfs.map((p) => p.pdf)).toContain('apresentacao');
    expect(pdfs.map((p) => p.pdf)).toContain('proposta_2027');
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
