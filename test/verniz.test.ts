import { describe, expect, it } from 'vitest';
import { respostaDoRedatorAceitavel, temConversaSocial } from '../src/domain/verniz';
import { processarMensagem, type Deps } from '../src/app/orchestrator';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../src/adapters/memory';
import { MockNLU } from '../src/adapters/MockNLU';
import { MSG } from '../src/domain/persona';
import type { Redator } from '../src/ports';

describe('temConversaSocial', () => {
  it.each([
    'Oi, tudo bem?',
    'Bom dia! Queria um orçamento',
    'olá',
    'Obrigada!',
    'um minuto que já te mando',
    'Boa tarde',
  ])('reconhece "%s"', (m) => {
    expect(temConversaSocial(m)).toBe(true);
  });

  it.each(['sábado', '150 convidados', '2028', 'Queria orçar valores para 2028 com vcs', 'sim', 'doideira'])(
    'não vê conversa social em "%s"',
    (m) => {
      expect(temConversaSocial(m)).toBe(false);
    },
  );
});

describe('respostaDoRedatorAceitavel', () => {
  const objetivo = 'Para fechar seu orçamento, me confirma o número de convidados?';

  it('aceita um verniz curto e fiel (cortesia + objetivo)', () => {
    expect(
      respostaDoRedatorAceitavel(
        objetivo,
        'Tudo ótimo, e com você? Para fechar seu orçamento, me confirma o número de convidados, ok?',
        'Oi, tudo bem? sábado',
      ),
    ).toBe(true);
  });

  it('rejeita "tudo ótimo, e com você?" quando ninguém perguntou como o bot está', () => {
    const resposta = 'Oi! Tudo ótimo, e com você? Para fechar seu orçamento, me confirma o número de convidados?';
    expect(respostaDoRedatorAceitavel(objetivo, resposta, 'Oi, sou fornecedor de decoração')).toBe(false);
    expect(respostaDoRedatorAceitavel(objetivo, resposta, 'Oi! Vocês fazem festa de 15 anos?')).toBe(false);
    // Quando perguntou, pode.
    expect(respostaDoRedatorAceitavel(objetivo, resposta, 'Oi, tudo bem? Queria saber o valor')).toBe(true);
    expect(respostaDoRedatorAceitavel(objetivo, resposta, 'olá, como vai?')).toBe(true);
  });

  it('um "Oi!" ou "Bom dia!" simples continua aceito', () => {
    expect(respostaDoRedatorAceitavel(objetivo, `Bom dia! ${objetivo}`, 'Bom dia, queria um orçamento')).toBe(true);
  });

  it.each(['Legal! ', 'Ah, então, ', 'Perfeito, ', 'Que legal! ', 'Ótimo! ', 'Show! '])(
    'rejeita abertura com interjeição ("%s")',
    (abertura) => {
      expect(respostaDoRedatorAceitavel(objetivo, `${abertura}Me confirma o número de convidados?`)).toBe(false);
    },
  );

  it('rejeita gíria que o objetivo não tinha ("e tal")', () => {
    expect(respostaDoRedatorAceitavel(objetivo, 'Pro orçamento e tal, me confirma os convidados?')).toBe(false);
  });

  it('rejeita número inventado (preço, convidados, data)', () => {
    expect(respostaDoRedatorAceitavel(objetivo, `${objetivo} O valor parte de R$ 27.900.`)).toBe(false);
    expect(respostaDoRedatorAceitavel(objetivo, 'Para 200 convidados, me confirma?')).toBe(false);
  });

  it('aceita números que já estavam no objetivo', () => {
    const o = 'Qual a data? Pode ser só o ano (2027 ou 2028).';
    expect(respostaDoRedatorAceitavel(o, 'Qual a data? Pode ser só o ano (2027 ou 2028), ok?')).toBe(true);
  });

  it('não pune uma interjeição que já estava no objetivo', () => {
    expect(
      respostaDoRedatorAceitavel('Perfeito! Vou verificar e já te retorno.', 'Perfeito! Vou verificar e já te retorno, ok?'),
    ).toBe(true);
  });

  it('rejeita vazio e texto muito maior que o objetivo', () => {
    expect(respostaDoRedatorAceitavel(objetivo, '   ')).toBe(false);
    expect(respostaDoRedatorAceitavel(objetivo, 'a'.repeat(600))).toBe(false);
  });
});

describe('persona: perguntas de dados faltantes sem interjeição', () => {
  it.each([0, 1, 2])('variante %i não começa com "Legal!" nem "Perfeito!"', (i) => {
    const t = MSG.pedirDadosFaltantes(['o número estimado de convidados'], i);
    expect(t).not.toMatch(/^(legal|perfeito|ótimo|ah)\b/i);
    expect(t).toMatch(/convidados/);
  });
});

describe('orquestrador: verniz do Redator só com conversa social', () => {
  const NOIVA = '5511977776666';
  let chamadas: string[];
  let deps: Deps;

  const redatorEspiao = (resposta: (objetivo: string) => string): Redator => ({
    async humanizar({ objetivo }) {
      chamadas.push(objetivo);
      return resposta(objetivo);
    },
  });

  const montar = (redator: Redator): void => {
    chamadas = [];
    deps = {
      contatos: new InMemoryContatoRepo(),
      conversas: new InMemoryConversaRepo(),
      nlu: new MockNLU(),
      calendario: new MockCalendario(),
      messaging: new SandboxProvider(),
      notifier: new RecordingNotifier(),
      redator,
      agora: () => '2026-10-15T15:00:00.000Z',
    };
  };

  // Preenche a conversa até a pergunta de convidados (turno de qualificação).
  const ultimoTexto = async (msg: string): Promise<string | undefined> => {
    const r = await processarMensagem(NOIVA, msg, deps);
    return r.saidas.filter((s) => s.tipo === 'texto').at(-1)?.texto;
  };

  it('sem conversa social na mensagem: o Redator nem é chamado e a pergunta vai literal', async () => {
    montar(redatorEspiao((o) => `Legal! ${o}`));
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    chamadas.length = 0;
    const texto = await ultimoTexto('sábado');
    expect(chamadas).toHaveLength(0);
    expect(texto).toMatch(/convidados/);
    expect(texto).not.toMatch(/^Legal/);
  });

  it('com conversa social: o Redator é chamado e um verniz fiel passa', async () => {
    montar(redatorEspiao((o) => `Tudo ótimo, e com você? ${o}`));
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    chamadas.length = 0;
    const texto = await ultimoTexto('tudo bem? sábado');
    expect(chamadas).toHaveLength(1);
    expect(texto).toMatch(/^Tudo ótimo, e com você\?/);
  });

  it('com conversa social, mas o Redator devolve interjeição: volta ao texto literal', async () => {
    montar(redatorEspiao((o) => `Legal! ${o}`));
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    chamadas.length = 0;
    const texto = await ultimoTexto('tudo bem? sábado');
    expect(chamadas).toHaveLength(1);
    expect(texto).toBe(chamadas[0]);
    expect(texto).not.toMatch(/^Legal/);
  });
});
