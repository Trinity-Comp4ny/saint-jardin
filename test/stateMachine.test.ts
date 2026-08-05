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
  it('no primeiro contato sem nome apresenta, manda PDF e pergunta o nome', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_nome');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[1]?.pdf).toBe('apresentacao');
    expect(r.saidas[2]?.texto).toMatch(/com quem/i);
  });

  it('no primeiro contato com o nome já dado pula direto à qualificação', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Marina' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.nome).toBe('Marina');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
  });

  it('no primeiro contato já aproveita dados completos e avança ao orçamento', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    // apresentação + PDF apresentação + anúncio + PDF proposta + descrição + convite
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto', 'pdf', 'texto', 'texto']);
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
    expect(r.saidas[0]?.texto).toMatch(/2027 ou 2028/);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('pergunta o dia do mês quando a noiva só disse o mês (sem dia)', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { mes: 10 } }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/qual dia de outubro/i);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('combina mês e dia de mensagens diferentes em mesDia e pergunta só o ano', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 300, mes: 10 }),
      nlu({ slots: { dia: 30 } }),
      ctx,
    );
    expect(r.conversa.slots.mesDia).toBe('10-30');
    // não estraga os convidados já coletados
    expect(r.conversa.slots.convidados).toBe(300);
    expect(r.saidas[0]?.texto).toMatch(/qual ano/i);
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

  it('envia o PDF do mini quando a noiva aceita', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), nlu({ afirmativo: true }), ctx);
    expect(r.conversa.estado).toBe('proposta_enviada');
    // anúncio curto + PDF do mini (2027 e 2028 na mesma proposta) + convite de visita
    expect(r.saidas[0]?.texto).toMatch(/mini wedding/i);
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_mini');
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
    expect(r.saidas[0]?.texto).toMatch(/2027 ou 2028/);
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

describe('humanização (flag)', () => {
  it('a pergunta qualificadora é humanizável', () => {
    // Com o nome já dado, o primeiro contato vai direto à qualificação.
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Marina' }), ctx);
    const q = r.saidas.find((s) => s.tipo === 'texto' && /convidados/.test(s.texto ?? ''));
    expect(q?.humanizar).toBe(true);
  });

  it('o orçamento (com preço) NÃO é humanizável', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 100, ano: 2027 }),
      nlu(),
      ctx,
    );
    const orc = r.saidas.find((s) => s.tipo === 'texto' && /Oferecemos/.test(s.texto ?? ''));
    expect(orc?.humanizar).toBeFalsy();
  });

  it('o anúncio do orçamento mini NÃO é humanizável', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), nlu({ afirmativo: true }), ctx);
    const anuncio = r.saidas.find((s) => s.tipo === 'texto' && /segue PDF/i.test(s.texto ?? ''));
    expect(anuncio?.humanizar).toBeFalsy();
  });
});

describe('variação de frases (anti-repetição)', () => {
  it('sementes diferentes geram perguntas de dados diferentes', () => {
    const base = conversaEm('aguardando_qualificacao');
    const a = decidir(base, nlu({ slots: { diaSemana: 'sabado' } }), { agora: AGORA, seed: 0 });
    const b = decidir(base, nlu({ slots: { diaSemana: 'sabado' } }), { agora: AGORA, seed: 1 });
    expect(a.saidas[0]?.texto).not.toBe(b.saidas[0]?.texto);
    expect(a.saidas[0]?.texto).toMatch(/convidados/);
    expect(b.saidas[0]?.texto).toMatch(/convidados/);
  });

  it('sementes diferentes geram perguntas de data diferentes', () => {
    const base = conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 100 });
    const a = decidir(base, nlu(), { agora: AGORA, seed: 0 });
    const b = decidir(base, nlu(), { agora: AGORA, seed: 2 });
    expect(a.saidas[0]?.texto).not.toBe(b.saidas[0]?.texto);
  });
});

describe('visita de noiva (coleta e repassa)', () => {
  it('só quer visitar (sem dados) apresenta e vai à preferência de visita', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas.some((s) => s.tipo === 'pdf' && s.pdf === 'apresentacao')).toBe(true);
    expect(r.saidas.at(-1)?.texto).toMatch(/algum dia/i);
  });

  it('orçamento + visita na primeira mensagem envia a proposta (não handoff silencioso)', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'agendar_visita', slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.some((s) => s.tipo === 'pdf' && s.pdf === 'proposta_2027')).toBe(true);
    expect(r.saidas.length).toBeGreaterThan(0);
  });

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

describe('data no passado', () => {
  it('avisa quando a data completa já passou, em vez de enviar a proposta', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', {
        diaSemana: 'sabado',
        convidados: 100,
        data: '2027-01-10',
        ano: 2027,
      }),
      nlu(),
      { agora: '2027-06-01T12:00:00.000Z' }, // depois de 10/01/2027
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/já passou/i);
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

  it('quer agendar visita sem dados de orçamento conduz à preferência (não handoff)', () => {
    const r = decidir(conversaEm('aguardando_qualificacao'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/algum dia/i);
  });

  it('sem sinal claro na proposta, encerra cordialmente (não re-convida em loop)', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu(), ctx);
    expect(r.conversa.estado).toBe('encerrada');
    // Não repete o convite ("agendar um dia"): fica à disposição, sem pergunta de convite.
    expect(r.saidas[0]?.texto).not.toMatch(/agendar um dia/i);
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

describe('recusa e encerramento (mata o loop do convite)', () => {
  it('recusa da visita na proposta encerra e não repete o convite', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ negativo: true }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
    expect(r.saidas).toHaveLength(1);
    expect(r.saidas[0]?.texto).not.toMatch(/agendar um dia/i);
    expect(r.saidas[0]?.texto).toMatch(/disposição|à disposição|me chama/i);
  });

  it('recusa do mini encerra em vez de empurrar visita', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), nlu({ negativo: true }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
  });

  it('recusa na preferência de visita encerra sem repassar para a Raquel', () => {
    const r = decidir(conversaEm('aguardando_pref_visita'), nlu({ negativo: true }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
    expect(r.conversa.motivoHandoff).toBeUndefined();
  });

  it('recusa da proposta normal encerra sem re-explicar o limite', () => {
    const r = decidir(
      conversaEm('aguardando_confirmacao_normal', { preferenciaDia: 'dia_de_semana', convidados: 150 }),
      nlu({ negativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('encerrada');
  });

  it('despedida encerra em qualquer ponto', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'despedida' }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
  });

  it('encerrada reabre quando volta com nova cotação', () => {
    const r = decidir(
      conversaEm('encerrada', { convidados: 150 }),
      nlu({ slots: { diaSemana: 'sabado', ano: 2028 } }),
      ctx,
    );
    // Reabre e chega direto na proposta (já tinha convidados; agora veio dia+ano).
    expect(r.conversa.estado).toBe('proposta_enviada');
  });

  it('encerrada continua quieta diante de outro "não"', () => {
    const r = decidir(conversaEm('encerrada'), nlu({ negativo: true }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
    expect(r.saidas).toHaveLength(0);
  });

  it('encerrada reabre o convite de visita quando ela aceita depois', () => {
    const r = decidir(conversaEm('encerrada'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });
});

describe('re-cotação na proposta', () => {
  it('pergunta por outro ano depois da proposta re-cota (não ignora)', () => {
    const r = decidir(
      conversaEm('proposta_enviada', { diaSemana: 'sabado', convidados: 200, ano: 2027 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.some((s) => s.tipo === 'pdf' && s.pdf === 'proposta_2028')).toBe(true);
  });
});

describe('mini wedding pedido em fim de semana', () => {
  it('explica que o mini é só dia de semana e oferece a proposta normal', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ pediuMini: true, slots: { diaSemana: 'sabado', convidados: 50 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_confirmacao_normal');
    expect(r.saidas[0]?.texto).toMatch(/mini wedding é só/i);
  });

  it('lembra do pedido de mini entre turnos (persistido nos slots)', () => {
    // Turno 1: pede mini sem dados.
    const t1 = decidir(conversaEm('novo'), nlu({ pediuMini: true }), ctx);
    expect(t1.conversa.slots.pediuMini).toBe(true);
    // Turno 2: informa sábado + convidados (sem repetir "mini") e ainda assim explica a regra.
    const t2 = decidir(t1.conversa, nlu({ slots: { diaSemana: 'sabado', convidados: 50 } }), ctx);
    expect(t2.conversa.estado).toBe('aguardando_confirmacao_normal');
    expect(t2.saidas[0]?.texto).toMatch(/mini wedding é só/i);
  });
});

describe('coleta do nome da noiva', () => {
  it('captura o nome respondido e segue para a qualificação', () => {
    const r = decidir(conversaEm('aguardando_nome'), nlu({ nomeDetectado: 'Marina' }), ctx);
    expect(r.conversa.slots.nome).toBe('Marina');
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    // pede os dados do orçamento (dia/convidados), já que ela só deu o nome
    expect(r.saidas[0]?.texto).toMatch(/convidados|sábado|dia de semana/i);
  });

  it('não fica preso pedindo o nome se ela não responde com um', () => {
    const r = decidir(conversaEm('aguardando_nome'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.nome).toBeUndefined();
  });

  it('o nome fica guardado nos slots entre turnos', () => {
    const t1 = decidir(conversaEm('aguardando_nome'), nlu({ nomeDetectado: 'Ana' }), ctx);
    const t2 = decidir(t1.conversa, nlu({ slots: { diaSemana: 'sabado', convidados: 200, ano: 2027 } }), ctx);
    expect(t2.conversa.slots.nome).toBe('Ana');
    expect(t2.conversa.estado).toBe('proposta_enviada');
  });
});

describe('fornecedor / não-noiva', () => {
  it('avisa que vai chamar a Raquel e transborda já no primeiro contato', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'fornecedor' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/fornecedor/i);
    expect(r.saidas[0]?.texto).toMatch(/chamar a Raquel/i);
  });
});
