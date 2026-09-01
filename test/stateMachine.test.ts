import { describe, expect, it } from 'vitest';
import {
  classificarDia,
  decidir,
  ehMiniWedding,
  novaConversa,
  resumoEvento,
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
  it('1º contato sem nome: saudação pede o nome + PDF + qualificadora literal', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[0]?.texto).toMatch(/com quem eu falo/i);
    expect(r.saidas[1]?.pdf).toBe('apresentacao');
    // a mensagem após o PDF é a qualificadora oficial, literal (não humanizável)
    expect(r.saidas[2]?.texto).toMatch(/Para orçamento, você poderia me informar a data e o ano/);
    expect(r.saidas[2]?.humanizar).toBeFalsy();
  });

  it('1º contato com o nome: saudação personaliza e não pede o nome', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Marina' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.nome).toBe('Marina');
    expect(r.saidas[0]?.texto).toMatch(/Oii Marina, tudo bem/);
    expect(r.saidas[0]?.texto).not.toMatch(/com quem/i);
    expect(r.saidas[2]?.texto).toMatch(/Para orçamento/);
  });

  it('1º contato com dados completos (ex.: áudio que já deu tudo) avança direto à proposta', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ nomeDetectado: 'Marina', slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    // Apresentação sempre vai primeiro, mas não repete a qualificadora: os dados
    // já vieram, então pula direto pra proposta no mesmo turno.
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas[0]?.texto).toMatch(/Oii Marina/);
    expect(r.saidas[1]?.pdf).toBe('apresentacao');
    expect(r.saidas.some((s) => s.texto?.includes('Para orçamento, você poderia'))).toBe(false);
    expect(r.saidas.find((s) => s.tipo === 'pdf' && s.pdf !== 'apresentacao')?.pdf).toBe('proposta_2027');
  });

  it('1º contato com dado parcial (só o dia) pergunta só o que falta, sem repetir a qualificadora inteira', () => {
    const r = decidir(conversaEm('novo'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.diaSemana).toBe('sabado');
    // Apresentação + só a pergunta do que falta (convidados), não a qualificadora literal.
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[2]?.texto).toMatch(/convidados/);
    expect(r.saidas[2]?.texto).not.toMatch(/Para orçamento, você poderia/);
  });

  it('1º contato sem nenhum dado mantém a qualificadora literal completa', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[2]?.texto).toMatch(/Para orçamento, você poderia me informar a data e o ano/);
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
  it('dia de semana com mais de 80 vai direto à proposta normal (sem confirmação)', () => {
    // Tem dia + convidados; falta só o ano -> pergunta o ano, já no caminho normal.
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { preferenciaDia: 'dia_de_semana', convidados: 200 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/2027 ou 2028|dia, mês e ano/i);
    // não oferece mini nem pede confirmação de "quer que eu envie"
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
  });

  it('com dia de semana, mais de 80 e o ano, manda a proposta normal direto', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { preferenciaDia: 'dia_de_semana', convidados: 200 }),
      nlu({ slots: { ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
  });
});

describe('fim de semana com poucos convidados', () => {
  it('vai direto à proposta normal (mini é só dia de semana)', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 50 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
  });
});

describe('humanização (flag)', () => {
  it('a pergunta qualificadora do 1º contato é LITERAL (não humanizável)', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Marina' }), ctx);
    const q = r.saidas.find((s) => s.tipo === 'texto' && /Para orçamento/.test(s.texto ?? ''));
    expect(q).toBeDefined();
    expect(q?.humanizar).toBeFalsy();
  });

  it('o pedido de dados que faltam recebe verniz (humanizável) e usa "fechar"', () => {
    const r = decidir(conversaEm('aguardando_qualificacao'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.saidas[0]?.humanizar).toBe(true);
    expect(r.saidas[0]?.texto).toMatch(/fechar seu orçamento/i);
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

  it('orçamento + visita na 1ª mensagem, com dados completos: cota já no 1º turno (não handoff)', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'agendar_visita', nomeDetectado: 'Marina', slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.some((s) => s.tipo === 'pdf' && s.pdf === 'proposta_2027')).toBe(true);
  });

  it('orçamento parcial + visita na 1ª mensagem: continua pedindo o que falta (não pula pra visita)', () => {
    // Regressão: pediu visita, mas só deu o dia (faltou convidados) — "quero
    // visitar" não deve fazer o bot pular o que ainda falta pro orçamento.
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'agendar_visita', slots: { diaSemana: 'sabado' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.diaSemana).toBe('sabado');
    expect(r.saidas.at(-1)?.texto).toMatch(/convidados/);
  });

  it('orçamento parcial (ano+convidados, sem dia) + visita: pergunta o dia, não pula pra visita', () => {
    // Reprodução exata do relato: "queria conhecer o espaço... ano que vem...
    // 400 convidados" — deu ano e convidados, mas nunca disse sábado/domingo/dia
    // de semana. O bot não pode avançar sem essa resposta.
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'agendar_visita', slots: { ano: 2027, convidados: 400 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.convidados).toBe(400);
    expect(r.saidas.at(-1)?.texto).toMatch(/sábado.*domingo.*dia de semana/i);
  });

  it('quer visitar e não deu NENHUM dado no turno seguinte: aí sim pula pra preferência de visita', () => {
    // Turno 1 sem dado nenhum já deixou a conversa em 'aguardando_qualificacao'
    // (abertura padrão). Turno 2: ela só diz que quer visitar, sem dado novo.
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ intencao: 'agendar_visita' }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/algum dia/i);
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

  it('só preferência (sem data concreta): não promete um dia, diz que vai ver na agenda', () => {
    const r = decidir(
      conversaEm('aguardando_pref_visita'),
      nlu({ visita: { diaSemana: 'domingo', periodo: 'manha' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita da noiva/);
    expect(r.conversa.motivoHandoff).toMatch(/domingo/);
    // não diz "esse dia" (o bot não tem calendário nem uma data ainda)
    expect(r.saidas[0]?.texto).toMatch(/ver um dia e horário/i);
    expect(r.saidas[0]?.texto).not.toMatch(/esse dia/i);
  });

  it('dia e horário concretos: acusa o que ela pediu e repassa para a Raquel', () => {
    const r = decidir(
      conversaEm('aguardando_pref_visita'),
      nlu({ visita: { dataHora: 'dia 12 às 10h' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/dia 12 às 10h/);
    expect(r.saidas[0]?.texto).toMatch(/anotei dia 12 às 10h/i);
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

  it('encerrada reabre o convite de visita quando ela PEDE a visita depois', () => {
    const r = decidir(conversaEm('encerrada'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });

  it('um "ok" de despedida em encerrada NÃO reabre a visita (fica quieto)', () => {
    const r = decidir(conversaEm('encerrada'), nlu({ afirmativo: true }), ctx);
    expect(r.conversa.estado).toBe('encerrada');
    expect(r.saidas).toHaveLength(0);
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

describe('coleta do nome da noiva', () => {
  it('a saudação personaliza quando a noiva se apresenta na 1ª mensagem', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Ester' }), ctx);
    expect(r.conversa.slots.nome).toBe('Ester');
    // saudação vira "Oii Ester, tudo bem?..." e NÃO pergunta o nome de novo
    expect(r.saidas[0]?.texto).toMatch(/Oii Ester/);
    expect(r.saidas[0]?.texto).not.toMatch(/com quem/i);
  });

  it('a saudação pergunta o nome quando ela ainda não se apresentou', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.saidas[0]?.texto).toMatch(/com quem eu falo/i);
  });

  it('o nome fica guardado nos slots entre turnos', () => {
    const t1 = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Ana' }), ctx);
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

describe('resumo do evento para a Raquel', () => {
  it('data completa, dia da semana e convidados', () => {
    expect(resumoEvento({ data: '2028-10-15', diaSemana: 'sabado', convidados: 200 }))
      .toBe('15/10/2028 · sábado · 200 convidados');
  });

  it('só o ano (o suficiente pro orçamento)', () => {
    expect(resumoEvento({ ano: 2028 })).toBe('2028');
  });

  it('mês sem ano fica "a definir"', () => {
    expect(resumoEvento({ mes: 10, convidados: 80 })).toBe('outubro (ano a definir) · 80 convidados');
  });

  it('dia/mês (mesDia) com ano vira data cheia', () => {
    expect(resumoEvento({ mesDia: '10-30', ano: 2027 })).toBe('30/10/2027');
  });

  it('preferência genérica quando não há dia da semana exato', () => {
    expect(resumoEvento({ ano: 2027, preferenciaDia: 'dia_de_semana', convidados: 60 }))
      .toBe('2027 · dia de semana · 60 convidados');
  });

  it('vazio quando nada foi coletado', () => {
    expect(resumoEvento({})).toBe('');
  });
});
