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

  it('pergunta a data específica quando falta o que define o ano', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { diaSemana: 'sabado', convidados: 200 } }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/data em mente/i);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('pergunta só o ano quando a noiva deu dia/mês sem ano', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { mesDia: '01-26' } }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/qual ano/i);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('avança direto à proposta quando a data completa traz o ano', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { data: '2028-05-16' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
  });

  it('monta a data quando junta dia/mês já dado com o ano informado depois', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200, mesDia: '01-26' }),
      nlu({ slots: { ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
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

describe('dia de semana acima do limite do mini', () => {
  it('explica o limite e espera confirmação em vez de mandar a proposta', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { preferenciaDia: 'dia_de_semana', convidados: 200 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_confirmacao_normal');
    expect(r.saidas).toHaveLength(1);
    expect(r.saidas[0]?.texto).toMatch(/80 convidados/);
    // não manda PDF antes de confirmar
    expect(r.saidas.some((s) => s.tipo === 'pdf')).toBe(false);
  });

  it('ao confirmar, pergunta a data e passa para aguardando_data_normal', () => {
    const r = decidir(
      conversaEm('aguardando_confirmacao_normal', { preferenciaDia: 'dia_de_semana', convidados: 200 }),
      nlu({ afirmativo: true }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/data em mente/i);
    expect(r.conversa.estado).toBe('aguardando_data_normal');
  });

  it('confirmado, o ano na sequência gera a proposta (sem repetir a explicação)', () => {
    const r = decidir(
      conversaEm('aguardando_data_normal', { preferenciaDia: 'dia_de_semana', convidados: 200 }),
      nlu({ slots: { ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
  });

  it('se a noiva corrige para até 80, passa a oferecer o mini', () => {
    const r = decidir(
      conversaEm('aguardando_confirmacao_normal', { preferenciaDia: 'dia_de_semana', convidados: 200 }),
      nlu({ slots: { convidados: 60 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_interesse_mini');
    expect(r.saidas[0]?.texto).toMatch(/mini wedding/i);
  });
});

describe('visita de noiva (coleta e repassa)', () => {
  it('aceite da visita pergunta a preferência de dia', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ afirmativo: true }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/algum dia/i);
  });

  it('intenção agendar_visita na proposta também coleta a preferência (não transborda)', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });

  it('com a preferência, repassa para a Raquel com o dia no motivo', () => {
    const r = decidir(
      conversaEm('aguardando_pref_visita'),
      nlu({ visita: { diaSemana: 'sabado', periodo: 'manha' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita da noiva/);
    expect(r.conversa.motivoHandoff).toMatch(/sabado/);
    expect(r.saidas[0]?.texto).toMatch(/te retorno/i);
  });
});

describe('visita técnica (valida e repassa)', () => {
  it('sem data, pergunta informando a regra (terça a sexta, 30 dias)', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'visita_tecnica' }), ctx);
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/terça a sexta/i);
  });

  it('data em fim de semana: orienta e segue coletando', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'visita_tecnica', slots: { data: '2026-09-19' } }), // sábado, 60d
      ctx,
    );
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/terça a sexta/i);
  });

  it('data com menos de 30 dias: orienta a antecedência', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'visita_tecnica', slots: { data: '2026-08-05' } }), // quarta, 15d
      ctx,
    );
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/30 dias/);
  });

  it('data terça-sexta e ≥30 dias: avisa que vai verificar e repassa', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'visita_tecnica', slots: { data: '2026-09-16' } }), // quarta, 57d
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita técnica/);
    expect(r.saidas[0]?.texto).toMatch(/verificar a disponibilidade/i);
  });

  it('continua o fluxo técnico pelo estado, mesmo sem intenção explícita', () => {
    const r = decidir(
      conversaEm('visita_tecnica_data'),
      nlu({ slots: { data: '2026-08-25' } }), // terça, 35d
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita técnica/);
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

  it('transborda quando quer agendar visita fora do fluxo de visita', () => {
    // Em proposta_enviada/aguardando_pref_visita a visita é coletada; nos demais
    // estados, "quer agendar visita" ainda é handoff.
    const r = decidir(conversaEm('aguardando_qualificacao'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
  });

  it('sem aceite, reforça o convite à visita', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu(), ctx);
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas[0]?.texto).toMatch(/agendar um dia/i);
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
