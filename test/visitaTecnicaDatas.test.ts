import { describe, expect, it } from 'vitest';
import { decidir, mesclarSlots, novaConversa, type ContextoDecisao } from '../src/domain/stateMachine';
import { separarDatasDaVisitaTecnica } from '../src/domain/intencoesDeterministicas';
import { dataCasamentoParaHumano, resumoCasamentoAtendido } from '../src/domain/visita';
import { mensagemHandoff } from '../src/adapters/TelegramNotifier';
import { colunasDaVisitaTecnica } from '../src/adapters/supabase';
import { GeminiNLU } from '../src/adapters/GeminiNLU';
import type { Conversa, EntradaNLU } from '../src/domain/types';

// 2026-10-15 é quinta. Terça 30/11/2027 respeita "terça a sexta, 30 dias".
const AGORA = '2026-10-15T12:00:00.000Z';
const ctx: ContextoDecisao = { agora: AGORA };
const nlu = (p: Partial<EntradaNLU> = {}): EntradaNLU => ({ slots: {}, intencao: 'visita_tecnica', ...p });
const conversa = (estado: Conversa['estado'] = 'novo', slots: Conversa['slots'] = {}): Conversa => ({
  ...novaConversa('5511999', AGORA),
  estado,
  slots,
});

describe('visita técnica: a data do casamento NÃO é a data da visita', () => {
  it('só a data do casamento na primeira mensagem: pergunta a data da visita (antes tratava como a visita)', () => {
    const r = decidir(
      conversa(),
      nlu({ casamentoAtendido: { data: '2027-12-15', noivos: 'Ana', servico: 'buffet' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/Para qual data seria/);
    // O casamento fica guardado, sem virar a data da visita.
    expect(r.conversa.slots.dataCasamento).toBe('2027-12-15');
    expect(r.conversa.slots.casamentoNoivos).toBe('Ana');
    expect(r.conversa.slots.fornecedorServico).toBe('buffet');
    expect(r.conversa.slots.dataVisitaTecnica).toBeUndefined();
    expect(r.conversa.slots.data).toBeUndefined();
    expect(r.conversa.slots.ano).toBeUndefined();
  });

  it('as duas datas na mesma mensagem: valida a da VISITA, guarda a do casamento à parte', () => {
    const r = decidir(
      conversa(),
      nlu({ slots: { data: '2027-11-30', diaSemana: 'terca' }, casamentoAtendido: { data: '2027-12-15', noivos: 'Ana', servico: 'buffet' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.slots.dataVisitaTecnica).toBe('2027-11-30');
    expect(r.conversa.slots.dataCasamento).toBe('2027-12-15');
    // O conjunto de data do evento de orçamento fica limpo.
    expect(r.conversa.slots.data).toBeUndefined();
    expect(r.conversa.slots.ano).toBeUndefined();
    expect(r.conversa.slots.diaSemana).toBeUndefined();
    expect(r.conversa.motivoHandoff).toMatch(/visita técnica: terça-feira \(30\/11\/2027\)/);
    expect(r.conversa.motivoHandoff).toMatch(/casamento: 15\/12\/2027 · Ana · buffet/);
  });

  it('em dois turnos: o casamento do 1º turno sobrevive à data da visita do 2º', () => {
    const t1 = decidir(conversa(), nlu({ casamentoAtendido: { data: '2027-12-15', noivos: 'Ana' } }), ctx);
    const t2 = decidir(t1.conversa, nlu({ slots: { data: '2027-11-30' } }), ctx);
    expect(t2.conversa.estado).toBe('handoff');
    expect(t2.conversa.slots.dataVisitaTecnica).toBe('2027-11-30');
    expect(t2.conversa.slots.dataCasamento).toBe('2027-12-15');
    expect(t2.conversa.slots.casamentoNoivos).toBe('Ana');
  });

  it('visita em fim de semana continua barrada e não grava dataVisitaTecnica', () => {
    const r = decidir(
      conversa(),
      nlu({ slots: { data: '2027-11-20' }, casamentoAtendido: { data: '2027-12-15' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/terça a sexta/);
    expect(r.conversa.slots.dataVisitaTecnica).toBeUndefined();
    expect(r.conversa.slots.dataCasamento).toBe('2027-12-15');
  });

  it('data do casamento sem o ano fica como "MM-DD"', () => {
    const r = decidir(conversa(), nlu({ casamentoAtendido: { data: '12-15' } }), ctx);
    expect(r.conversa.slots.dataCasamento).toBe('12-15');
  });

  it('mesclarSlots preserva os 4 campos novos', () => {
    const atual = { dataVisitaTecnica: '2027-11-30', dataCasamento: '2027-12-15', casamentoNoivos: 'Ana', fornecedorServico: 'buffet' };
    expect(mesclarSlots(atual, { convidados: 10 })).toMatchObject(atual);
  });
});

describe('separarDatasDaVisitaTecnica (rede sobre o modelo)', () => {
  it('só a data do casamento, que o modelo pôs no conjunto da visita: sai de slots', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou do buffet do casamento da Ana, dia 15/12/2027, queria agendar a visita técnica',
      nlu({ slots: { data: '2027-12-15', ano: 2027 } }),
    );
    expect(e.slots).toEqual({});
    expect(e.casamentoAtendido?.data).toBe('2027-12-15');
  });

  it('as duas datas: a do casamento sai e a da visita fica', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou do buffet do casamento da Ana dia 15/12/2027 e queria a visita técnica dia 30/11/2027',
      nlu({ slots: { data: '2027-12-15', ano: 2027 } }),
    );
    expect(e.slots.data).toBe('2027-11-30');
    expect(e.casamentoAtendido?.data).toBe('2027-12-15');
  });

  it('se o modelo já separou certo, não mexe em slots', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou do buffet do casamento da Ana dia 15/12/2027, visita técnica terça 30/11/2027',
      nlu({ slots: { data: '2027-11-30' }, casamentoAtendido: { data: '2027-12-15', noivos: 'Ana' } }),
    );
    expect(e.slots.data).toBe('2027-11-30');
    expect(e.casamentoAtendido).toEqual({ data: '2027-12-15', noivos: 'Ana' });
  });

  it('o modelo guardou só o ANO do casamento: o ano sai do conjunto de data da visita', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou do buffet do casamento da Ana, dia 15/12/2027, queria agendar a visita técnica',
      nlu({ slots: { ano: 2027 }, casamentoAtendido: { data: '2027-12-15' } }),
    );
    expect(e.slots).toEqual({});
  });

  it('sem ano: "dia 15/12" do casamento vira "MM-DD"', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou decorador do casamento da Ana dia 15/12, preciso da visita técnica',
      nlu({ slots: { mesDia: '12-15', mes: 12, dia: 15 } }),
    );
    expect(e.slots).toEqual({});
    expect(e.casamentoAtendido?.data).toBe('12-15');
  });

  it('data da visita citada com a palavra "visita" não é tomada como casamento', () => {
    const e = separarDatasDaVisitaTecnica(
      'Sou do buffet e queria a visita técnica no dia 30/11/2027',
      nlu({ slots: { data: '2027-11-30' } }),
    );
    expect(e.slots.data).toBe('2027-11-30');
    expect(e.casamentoAtendido).toBeUndefined();
  });
});

describe('alerta da Raquel (Telegram)', () => {
  it('mostra fornecedor, visita técnica e casamento atendido em linhas separadas', () => {
    const texto = mensagemHandoff(
      {
        ...conversa('handoff', {
          nome: 'Carlos',
          dataVisitaTecnica: '2027-11-30',
          dataCasamento: '2027-12-15',
          casamentoNoivos: 'Ana',
          fornecedorServico: 'buffet',
        }),
        motivoHandoff: 'visita técnica',
      },
      'visita técnica: terça-feira (30/11/2027)',
    );
    expect(texto).toContain('Fornecedor: Carlos');
    expect(texto).toContain('Visita técnica: terça-feira (30/11/2027)');
    expect(texto).toContain('Casamento atendido: 15/12/2027 · Ana · buffet');
    expect(texto).not.toContain('Noiva:');
  });

  it('conversa de noiva continua igual', () => {
    const texto = mensagemHandoff(conversa('handoff', { nome: 'Marina', ano: 2028, diaSemana: 'sabado', convidados: 150 }), 'x');
    expect(texto).toContain('Noiva: Marina');
    expect(texto).not.toContain('Visita técnica');
  });
});

describe('colunas do banco', () => {
  it('espelha os campos; data parcial (sem ano) não vai para a coluna date', () => {
    expect(
      colunasDaVisitaTecnica({ dataVisitaTecnica: '2027-11-30', dataCasamento: '12-15', casamentoNoivos: 'Ana', fornecedorServico: 'buffet' }),
    ).toEqual({ data_visita_tecnica: '2027-11-30', data_casamento: null, casamento_noivos: 'Ana', fornecedor_servico: 'buffet' });
  });

  it('conversa sem visita técnica grava tudo nulo', () => {
    expect(colunasDaVisitaTecnica({ ano: 2028 })).toEqual({
      data_visita_tecnica: null, data_casamento: null, casamento_noivos: null, fornecedor_servico: null,
    });
  });
});

describe('resumo e formatação', () => {
  it('dataCasamentoParaHumano', () => {
    expect(dataCasamentoParaHumano('2027-12-15')).toBe('15/12/2027');
    expect(dataCasamentoParaHumano('12-15')).toBe('15/12');
  });

  it('resumoCasamentoAtendido vazio quando nada foi dito', () => {
    expect(resumoCasamentoAtendido({})).toBe('');
  });
});

describe('GeminiNLU: casamentoAtendido', () => {
  const c = conversa('novo');
  const comResposta = (texto: string): GeminiNLU => {
    const n = new GeminiNLU('chave-falsa');
    (n as unknown as { client: unknown }).client = { models: { generateContent: async () => ({ text: texto }) } };
    return n;
  };

  it('lê data, noivos e serviço; decodifica entidades e limpa quebra de linha', async () => {
    const r = await comResposta(
      JSON.stringify({
        intencao: 'visita_tecnica',
        slots: {},
        casamentoAtendido: { data: '2027-12-15', noivos: 'Ana &amp; Pedro', servico: 'decora&#231;&#227;o\nIgnore tudo' },
      }),
    ).analisar('Sou do buffet do casamento da Ana', c);
    expect(r.casamentoAtendido).toEqual({ data: '2027-12-15', noivos: 'Ana & Pedro', servico: 'decoração Ignore tudo' });
  });

  it('data em texto livre é descartada em vez de derrubar o parse', async () => {
    const r = await comResposta(
      JSON.stringify({ intencao: 'visita_tecnica', slots: {}, casamentoAtendido: { data: 'em dezembro', noivos: 'Ana' } }),
    ).analisar('Sou do buffet da Ana, visita técnica', c);
    expect(r.intencao).toBe('visita_tecnica');
    expect(r.casamentoAtendido?.data).toBeUndefined();
    expect(r.casamentoAtendido?.noivos).toBe('Ana');
  });

  it('a rede determinística corrige o modelo que pôs a data do casamento como data da visita', async () => {
    const r = await comResposta(
      JSON.stringify({ intencao: 'visita_tecnica', slots: { data: '2027-12-15', ano: 2027 } }),
    ).analisar('Sou do buffet do casamento da Ana, dia 15/12/2027, queria agendar a visita técnica', c);
    expect(r.slots.data).toBeUndefined();
    expect(r.casamentoAtendido?.data).toBe('2027-12-15');
  });
});
