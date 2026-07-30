import { describe, expect, it } from 'vitest';
import {
  classificarDia,
  decidir,
  ehMiniWedding,
  novaConversa,
  type ContextoDecisao,
} from '../src/domain/stateMachine';
import type { Conversa, EntradaNLU } from '../src/domain/types';

const AGORA = '2026-07-21T12:00:00.000Z';
const ctx: ContextoDecisao = { agora: AGORA };

function nlu(parcial: Partial<EntradaNLU> = {}): EntradaNLU {
  return { slots: {}, intencao: 'seguir_fluxo', ...parcial };
}

function conversaEm(estado: Conversa['estado'], slots: Conversa['slots'] = {}): Conversa {
  return { ...novaConversa('5511999', AGORA), estado, slots };
}

describe('regras de negócio', () => {
  it('classifica sábado como fim de semana e quinta como dia de semana', () => {
    expect(classificarDia({ diaSemana: 'sabado' })).toBe('fim_de_semana');
    expect(classificarDia({ diaSemana: 'quinta' })).toBe('dia_de_semana');
    expect(classificarDia({ preferenciaDia: 'dia_de_semana' })).toBe('dia_de_semana');
    expect(classificarDia({})).toBeUndefined();
  });

  it('mini wedding é só dia de semana E até 80 convidados', () => {
    expect(ehMiniWedding({ diaSemana: 'quarta', convidados: 60 })).toBe(true);
    expect(ehMiniWedding({ diaSemana: 'quarta', convidados: 80 })).toBe(true);
    // dia de semana com mais de 80 -> valor normal, não mini
    expect(ehMiniWedding({ diaSemana: 'quarta', convidados: 200 })).toBe(false);
    // fim de semana nunca é mini, mesmo com poucos convidados
    expect(ehMiniWedding({ diaSemana: 'sabado', convidados: 50 })).toBe(false);
    expect(ehMiniWedding({ diaSemana: 'sabado', convidados: 200 })).toBe(false);
  });
});

describe('fluxo feliz - evento normal', () => {
  it('no primeiro contato apresenta, manda PDF e pergunta', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[1]?.pdf).toBe('apresentacao');
  });

  it('no primeiro contato já aproveita dados completos e avança ao orçamento', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    // apresentação + PDF apresentação + orçamento + PDF proposta + convite
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto', 'pdf', 'texto']);
    expect(r.saidas[1]?.pdf).toBe('apresentacao');
    expect(r.saidas[3]?.pdf).toBe('proposta_2027');
  });

  it('no primeiro contato com dado parcial, apresenta e pergunta só o que falta', () => {
    const r = decidir(conversaEm('novo'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    // não repete a pergunta qualificadora inteira: pede só o que falta (convidados)
    expect(r.saidas[2]?.texto).toContain('convidados');
  });

  it('pede dados que faltam quando só veio o dia', () => {
    const r = decidir(conversaEm('aguardando_qualificacao'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/convidados/);
  });

  it('pergunta o ano quando falta para escolher o PDF', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { diaSemana: 'sabado', convidados: 200 } }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/qual ano/i);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('envia orçamento e PDF do ano quando tudo está completo', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
    expect(r.saidas.at(-1)?.texto).toMatch(/agendar um dia/i);
  });
});

describe('fluxo mini wedding', () => {
  it('oferece mini wedding para dia de semana', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { preferenciaDia: 'dia_de_semana', convidados: 50 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_interesse_mini');
    expect(r.saidas[0]?.texto).toMatch(/mini wedding/i);
  });

  it('envia orçamento mini quando a noiva aceita', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), nlu({ afirmativo: true }), ctx);
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas[0]?.texto).toMatch(/mini wedding/i);
  });
});

describe('disponibilidade de data', () => {
  it('sugere alternativa quando a data está ocupada', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200, ano: 2027, data: '2027-10-09' }),
      nlu(),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-16' } },
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/2027-10-16/);
  });
});

describe('handoff', () => {
  it('transborda quando a noiva quer negociar', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'negociar' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas).toHaveLength(0);
  });

  it('transborda quando quer agendar visita', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
  });

  it('cliente já fechado transborda já no primeiro contato', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'cliente_fechado' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
  });

  it('não age quando a conversa já é humana', () => {
    const r = decidir(conversaEm('humano'), nlu({ intencao: 'negociar' }), ctx);
    expect(r.conversa.estado).toBe('humano');
    expect(r.saidas).toHaveLength(0);
  });
});
