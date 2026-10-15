import { describe, expect, it } from 'vitest';
import {
  classificarDia,
  dataCompleta,
  decidir,
  ehMiniWedding,
  mesclarSlots,
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
  it('1º contato pedindo orçamento: abertura da Raquel + vídeo + qualificadora literal', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto']);
    expect(r.saidas[0]?.texto).toMatch(/Me chamo Raquel e darei continuidade ao seu atendimento/);
    expect(r.saidas[0]?.texto).toMatch(/breve vídeo de apresentação/);
    // a abertura não pergunta o nome e é literal (nunca humanizada)
    expect(r.saidas[0]?.texto).not.toMatch(/com quem/i);
    expect(r.saidas[0]?.humanizar).toBeFalsy();
    expect(r.saidas[1]?.video).toBe('apresentacao');
    // a mensagem após o vídeo é a qualificadora oficial, literal (não humanizável)
    expect(r.saidas[2]?.texto).toMatch(/Para orçamento, você poderia me informar a data e o ano/);
    expect(r.saidas[2]?.humanizar).toBeFalsy();
  });

  it('1º contato com o nome: guarda o nome nos slots; a abertura continua a mesma', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Marina' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.nome).toBe('Marina');
    expect(r.saidas[0]?.texto).toMatch(/Me chamo Raquel/);
    expect(r.saidas[0]?.texto).not.toMatch(/Marina/);
    expect(r.saidas[2]?.texto).toMatch(/Para orçamento/);
  });

  it('1º contato com dados completos (ex.: áudio que já deu tudo) avança direto à proposta', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ nomeDetectado: 'Marina', slots: { diaSemana: 'sabado', convidados: 150, ano: 2027 } }),
      ctx,
    );
    // A abertura (texto + vídeo) sempre vai primeiro, mas não repete a qualificadora:
    // os dados já vieram, então pula direto pra proposta no mesmo turno.
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto', 'pdf', 'texto']);
    expect(r.saidas.at(-1)?.texto).toMatch(/^O que acharam da proposta\?/);
    expect(r.saidas[0]?.texto).toMatch(/Me chamo Raquel/);
    expect(r.saidas[1]?.video).toBe('apresentacao');
    expect(r.saidas[2]?.texto).toMatch(/proposta para casamentos em 2027/);
    expect(r.saidas.some((s) => s.texto?.includes('Para orçamento, você poderia'))).toBe(false);
    expect(r.saidas[3]?.pdf).toBe('proposta_2027');
  });

  it('1º contato com dado parcial (só o dia) pergunta só o que falta, sem repetir a qualificadora inteira', () => {
    const r = decidir(conversaEm('novo'), nlu({ slots: { diaSemana: 'sabado' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.diaSemana).toBe('sabado');
    // Abertura + só a pergunta do que falta (convidados), não a qualificadora literal.
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto']);
    expect(r.saidas[2]?.texto).toMatch(/convidados/);
    expect(r.saidas[2]?.texto).not.toMatch(/Para orçamento, você poderia/);
  });

  it('1º contato com dia/mês ("26 de janeiro") não repete a pergunta de data na qualificadora', () => {
    const r = decidir(conversaEm('novo'), nlu({ slots: { mesDia: '01-26' } }), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.mesDia).toBe('01-26');
    // pergunta só o que falta (dia da semana + convidados), não a qualificadora com data
    expect(r.saidas.at(-1)?.texto).not.toMatch(/Para orçamento, você poderia/);
    expect(r.saidas.at(-1)?.texto).toMatch(/convidados/);
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

  it('regressão: "30 de fevereiro" (data impossível) não trava — segue com o ano, sem checar disponibilidade inventada', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { data: '2028-02-30' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
  });

  it('dataCompleta rejeita data de calendário inexistente (unitário)', () => {
    expect(dataCompleta({ data: '2028-02-30' })).toBeUndefined();
    expect(dataCompleta({ mesDia: '02-30', ano: 2028 })).toBeUndefined();
    expect(dataCompleta({ mesDia: '13-01', ano: 2028 })).toBeUndefined(); // mês 13
    expect(dataCompleta({ data: '2028-05-16' })).toBe('2028-05-16'); // controle: data real
    expect(dataCompleta({ data: '2028-02-29' })).toBe('2028-02-29'); // 2028 é bissexto: válido
    expect(dataCompleta({ data: '2027-02-29' })).toBeUndefined(); // 2027 não é bissexto: inválido
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
    // Mensagem de ano (literal da Raquel) + PDF do ano + convite de visita (texto da
    // Raquel de 15/10/2026, literal e sem passar pelo Redator).
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[0]?.texto).toMatch(/proposta para casamentos em 2028/);
    expect(r.saidas[0]?.texto).toMatch(/Destination Wedding/);
    expect(r.saidas[1]?.pdf).toBe('proposta_2028');
    expect(r.saidas[2]?.texto).toBe(
      'O que acharam da proposta? Gostaria de agendar uma visita para conhecer nosso espaço pessoalmente? É ainda mais lindo! ✨',
    );
    expect(r.saidas[2]?.humanizar).toBeFalsy();
    expect(r.conversa.propostaEnviadaEm).toBe(AGORA);
  });

  it('proposta de 2027 usa o texto de 2027', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200 }),
      nlu({ slots: { ano: 2027 } }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toMatch(/proposta para casamentos em 2027/);
    expect(r.saidas[1]?.pdf).toBe('proposta_2027');
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
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[2]?.texto).toMatch(/^O que acharam da proposta\?/);
    expect(r.saidas[0]?.texto).toMatch(/mini wedding/i);
    expect(r.saidas[1]?.pdf).toBe('proposta_mini');
    expect(r.conversa.propostaEnviadaEm).toBe(AGORA);
  });

  it('regressão: responder com uma data (sem "sim" explícito) também envia o PDF do mini', () => {
    // NLU não marca afirmativo/negativo quando a mensagem traz um dado novo
    // (é a regra do próprio prompt) — dar uma data aqui só faz sentido como
    // aceite, então não pode cair no fallback que nunca manda o PDF.
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ slots: { data: '2027-03-15' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_mini');
  });

  it('recusa explícita pergunta se pode enviar as propostas tradicionais (não manda PDF ainda)', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ negativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_aceite_tradicional');
    expect(r.saidas).toHaveLength(1);
    expect(r.saidas[0]?.texto).toBe(
      'Podemos então enviar nossas propostas tradicionais que incluem o final de semana também?',
    );
    expect(r.saidas[0]?.humanizar).toBeFalsy();
  });

  it('pergunta sobre o mini (sem sim nem não) manda o PDF do mini com as informações', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu(),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[0]?.texto).toBe('Segue nosso PDF de mini wedding com as informações:');
    expect(r.saidas[1]?.pdf).toBe('proposta_mini');
  });

  it('quem responde ao mini pedindo para conhecer o espaço vai para a visita', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini'),
      nlu({ intencao: 'agendar_visita' }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });
});

describe('aceite das propostas tradicionais depois de recusar o mini', () => {
  const slotsMini = { diaSemana: 'quarta', convidados: 50, ano: 2028 } as const;

  it('"sim" envia a proposta normal do ano pedido (e não oferece o mini de novo)', () => {
    const r = decidir(
      conversaEm('aguardando_aceite_tradicional', slotsMini),
      nlu({ afirmativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[0]?.texto).toMatch(/proposta para casamentos em 2028/);
    expect(r.saidas[1]?.pdf).toBe('proposta_2028');
    expect(r.conversa.slots.tradicionalAceito).toBe(true);
  });

  it('"sim" sem o ano ainda pergunta o ano, sem voltar à oferta do mini', () => {
    const r = decidir(
      conversaEm('aguardando_aceite_tradicional', { diaSemana: 'quarta', convidados: 50 }),
      nlu({ afirmativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/2027 ou 2028/);
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);

    // Na resposta com o ano, vai a proposta (o mini não volta, mesmo sendo quarta com 50).
    const r2 = decidir(r.conversa, nlu({ slots: { ano: 2027 } }), ctx);
    expect(r2.conversa.estado).toBe('proposta_enviada');
    expect(r2.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
  });

  it('responder só com o ano também vale como aceite', () => {
    const r = decidir(
      conversaEm('aguardando_aceite_tradicional', { diaSemana: 'quarta', convidados: 50 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
  });

  it('"não" encerra com despedida cordial', () => {
    const r = decidir(
      conversaEm('aguardando_aceite_tradicional', slotsMini),
      nlu({ negativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('encerrada');
    expect(r.saidas.some((s) => s.tipo === 'pdf')).toBe(false);
  });

  it('sem sinal claro fica quieta', () => {
    const r = decidir(conversaEm('aguardando_aceite_tradicional', slotsMini), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_aceite_tradicional');
    expect(r.saidas).toHaveLength(0);
  });
});

describe('primeira mensagem: só inicia o fluxo comercial se pedir orçamento', () => {
  it('só um cumprimento: pergunta como pode ajudar e espera o assunto', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'saudacao' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_assunto');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto']);
    expect(r.saidas[0]?.texto).toBe(
      'Olá, tudo bem? O Saint Jardin Eventos agradece seu contato. Como posso ajudar?',
    );
    expect(r.saidas[0]?.humanizar).toBeFalsy();
  });

  it('depois do "como posso ajudar", pedir orçamento inicia o fluxo completo', () => {
    const r = decidir(conversaEm('aguardando_assunto'), nlu(), ctx);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto']);
  });

  it('depois do "como posso ajudar", a abertura vai SEM o segundo "Olá, tudo bem?"', () => {
    const depois = decidir(conversaEm('aguardando_assunto'), nlu(), ctx);
    expect(depois.saidas[0]?.texto).toMatch(/^Me chamo Raquel e darei continuidade ao seu atendimento\./);
    expect(depois.saidas[0]?.texto).not.toMatch(/tudo bem/i);
    // o resto da abertura é o mesmo texto da Raquel
    const direto = decidir(conversaEm('novo'), nlu(), ctx);
    expect(direto.saidas[0]?.texto).toMatch(/^Olá, tudo bem\? Me chamo Raquel/);
    expect(direto.saidas[0]?.texto?.replace(/^Olá, tudo bem\? /, '')).toBe(depois.saidas[0]?.texto);
  });

  it('depois do "como posso ajudar", dúvida + dado de orçamento: só "vou verificar", sem vídeo', () => {
    const r = decidir(
      conversaEm('aguardando_assunto'),
      nlu({ intencao: 'fora_do_script', slots: { diaSemana: 'sabado' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto']);
    expect(r.saidas[0]?.texto).toMatch(/já te respondo/i);
  });

  it('depois do "como posso ajudar", outro cumprimento não repete a pergunta', () => {
    const r = decidir(conversaEm('aguardando_assunto'), nlu({ intencao: 'saudacao' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_assunto');
    expect(r.saidas).toHaveLength(0);
  });

  it('depois do "como posso ajudar", dúvida que não é orçamento vai para a Raquel sem vídeo', () => {
    const r = decidir(conversaEm('aguardando_assunto'), nlu({ intencao: 'fora_do_script' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas.some((s) => s.tipo === 'video')).toBe(false);
    expect(r.saidas.at(-1)?.texto).toMatch(/já te respondo/i);
  });

  it('depois do "como posso ajudar", cliente fechado transborda em silêncio', () => {
    const r = decidir(conversaEm('aguardando_assunto'), nlu({ intencao: 'cliente_fechado' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas).toHaveLength(0);
  });

  it('cumprimento que já traz dado de orçamento não é cumprimento: segue o fluxo', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'saudacao', slots: { diaSemana: 'sabado' } }),
      ctx,
    );
    expect(r.saidas.some((s) => s.tipo === 'video')).toBe(true);
  });

  it('cumprimento fora do primeiro contato (ex.: proposta enviada) não muda nada', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'saudacao' }), ctx);
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas).toHaveLength(0);
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
  it('só quer visitar (sem dados) abre com o vídeo e vai à preferência de visita', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas.some((s) => s.tipo === 'video' && s.video === 'apresentacao')).toBe(true);
    expect(r.saidas.at(-1)?.texto).toMatch(/que dia ficará melhor/i);
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
    expect(r.saidas[0]?.texto).toMatch(/que dia ficará melhor/i);
  });

  it('o convite de visita é o texto da Raquel (horários) e vai literal', () => {
    const r = decidir(conversaEm('aguardando_qualificacao'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.saidas[0]?.texto).toBe(
      'Realizamos visitas de segunda a sexta-feira, em horário comercial, e aos sábados, das 8h às 13h.\n' +
        'Que dia ficará melhor para vocês?',
    );
    expect(r.saidas[0]?.humanizar).toBeFalsy();
  });

  it('"sim" depois do follow-up é aceite da visita: pergunta o dia', () => {
    const r = decidir(
      { ...conversaEm('proposta_enviada'), followupEnviadoEm: AGORA },
      nlu({ afirmativo: true }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/que dia ficará melhor/i);
  });

  it('"sim" logo depois da proposta aceita o convite de visita que a proposta trouxe', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ afirmativo: true }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/que dia ficará melhor/i);
  });

  it('intenção agendar_visita na proposta também coleta a preferência (não transborda)', () => {
    const r = decidir(conversaEm('proposta_enviada'), nlu({ intencao: 'agendar_visita' }), ctx);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });

  it('só preferência (sem data concreta): não promete um dia, diz que vai ver na agenda', () => {
    const r = decidir(
      conversaEm('aguardando_pref_visita'),
      nlu({ visita: { diaSemana: 'quinta', periodo: 'manha' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita da noiva/);
    expect(r.conversa.motivoHandoff).toMatch(/quinta/);
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

  it('avisa a Raquel quando a mesma mensagem também traz convidados (pode ser pedido de orçamento próprio junto)', () => {
    const r = decidir(
      conversaEm('visita_tecnica_data'),
      nlu({ slots: { data: '2026-08-25', convidados: 200 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/visita técnica/);
    expect(r.conversa.motivoHandoff).toMatch(/convidados/);
  });

  it('não avisa quando é só a data da visita técnica, sem convidados junto (sem alarme falso)', () => {
    const r = decidir(
      conversaEm('visita_tecnica_data'),
      nlu({ slots: { data: '2026-08-25' } }),
      ctx,
    );
    expect(r.conversa.motivoHandoff).not.toMatch(/convidados/);
  });

  it('a data do CASAMENTO já coletada não vira a data da visita técnica', () => {
    // Noiva com data marcada nos slots pede visita técnica sem dizer a data:
    // antes, resolverDataTecnica pegava a data do casamento e repassava pra
    // Raquel como se fosse a data da visita.
    const r = decidir(
      conversaEm('aguardando_qualificacao', { data: '2027-10-30', ano: 2027, convidados: 150 }),
      nlu({ intencao: 'visita_tecnica' }),
      ctx,
    );
    expect(r.conversa.estado).toBe('visita_tecnica_data');
    expect(r.saidas[0]?.texto).toMatch(/terça a sexta/i);
  });

  it('dentro do fluxo técnico, dia/mês + ano dados em turnos separados ainda combinam', () => {
    const t1 = decidir(
      conversaEm('aguardando_qualificacao', { data: '2027-10-30', ano: 2027 }),
      nlu({ intencao: 'visita_tecnica' }),
      ctx,
    );
    // Turno seguinte: só a data da visita (terça 25/08/2026, 35d à frente).
    const t2 = decidir(t1.conversa, nlu({ slots: { data: '2026-08-25' } }), ctx);
    expect(t2.conversa.estado).toBe('handoff');
    expect(t2.conversa.motivoHandoff).toMatch(/25\/08\/2026/);
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
  it('sugere alternativa quando a data está ocupada, em formato humano (nunca ISO cru)', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200, ano: 2027, data: '2027-10-09' }),
      nlu(),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-16' } },
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas[0]?.texto).toMatch(/09\/10\/2027/);
    expect(r.saidas[0]?.texto).toMatch(/16\/10\/2027/);
    expect(r.saidas[0]?.texto).not.toMatch(/2027-10/);
    // marca o aviso para o próximo turno poder interpretar "pode ser" como aceite
    expect(r.conversa.slots.dataOcupadaAvisada).toBe('2027-10-09');
  });

  it('aceite da alternativa oferecida ("pode ser") adota a data e envia a proposta', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', {
        diaSemana: 'sabado', convidados: 200, ano: 2027,
        data: '2027-10-09', dataOcupadaAvisada: '2027-10-09',
      }),
      nlu({ afirmativo: true }),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-16' } },
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.conversa.slots.data).toBe('2027-10-16');
    expect(r.conversa.slots.dataOcupadaAvisada).toBeUndefined();
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
  });

  it('recusa da alternativa limpa a data ocupada e pergunta outra (sem loop de "reservada")', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', {
        diaSemana: 'sabado', convidados: 200, ano: 2027,
        data: '2027-10-09', dataOcupadaAvisada: '2027-10-09',
      }),
      nlu({ negativo: true }),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-16' } },
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.data).toBeUndefined();
    expect(r.conversa.slots.ano).toBe(2027); // a preferência de ano fica
    expect(r.saidas[0]?.texto).toMatch(/data/i);
    expect(r.saidas[0]?.texto).not.toMatch(/reservada/i);
  });

  it('um "sim" SEM aviso prévio de data ocupada não adota alternativa nenhuma', () => {
    // Sem o aviso do turno anterior, o afirmativo pode ser sobre outra coisa:
    // o certo é avisar que a data está ocupada, não trocar a data sozinho.
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200, ano: 2027, data: '2027-10-09' }),
      nlu({ afirmativo: true }),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-16' } },
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.conversa.slots.data).toBe('2027-10-09');
    expect(r.saidas[0]?.texto).toMatch(/reservada/i);
  });

  it('sem alternativa real (calendário devolveu a própria data), pergunta outra data sem oferecer a mesma', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 200, ano: 2027, data: '2027-10-09' }),
      nlu(),
      { agora: AGORA, disponibilidadeData: { data: '2027-10-09', livre: false, alternativa: '2027-10-09' } },
    );
    expect(r.saidas[0]?.texto).toMatch(/outra data/i);
    expect(r.saidas[0]?.texto).not.toMatch(/oferecer/i);
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
    expect(r.saidas[0]?.texto).toMatch(/que dia ficará melhor/i);
  });

  it('regressão: sem sinal claro na proposta (ex.: correção de nome) NÃO encerra sozinho nem re-convida', () => {
    // Era um fallback incondicional: QUALQUER mensagem sem sim/dado novo/
    // agendar_visita fechava a conversa, mesmo sem recusa nenhuma — ex.: "ah
    // desculpa, é Beatriz meu nome, não Ana" fechava a conversa e ela ficava
    // muda. Despedida de verdade já é pega pelo guard do topo de `decidir`;
    // aqui, sem sinal claro, o certo é ficar quieta, não fechar.
    const r = decidir(
      conversaEm('proposta_enviada', { diaSemana: 'sabado', convidados: 150, ano: 2027 }),
      nlu({ nomeDetectado: 'Beatriz' }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas).toHaveLength(0);
    expect(r.conversa.slots.nome).toBe('Beatriz'); // a correção de nome não se perde
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

  it('recusa do mini não empurra visita: pergunta das propostas tradicionais', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), nlu({ negativo: true }), ctx);
    expect(r.conversa.estado).toBe('aguardando_aceite_tradicional');
    expect(r.saidas.some((s) => /visita/i.test(s.texto ?? ''))).toBe(false);
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

  it('"e para 2028?" com data completa antiga move a data pro ano novo (não mantém a velha)', () => {
    // Regressão: a data completa antiga (2027-10-30) continuava mandando em
    // `dataCompleta` — o PDF saía de 2028 mas a disponibilidade era checada
    // na data de 2027.
    const r = decidir(
      conversaEm('proposta_enviada', { diaSemana: 'sabado', convidados: 200, data: '2027-10-30', ano: 2027 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.conversa.slots.data).toBeUndefined();
    expect(r.conversa.slots.mesDia).toBe('10-30');
    expect(r.conversa.slots.ano).toBe(2028);
    expect(dataCompleta(r.conversa.slots)).toBe('2028-10-30');
    expect(r.saidas.some((s) => s.tipo === 'pdf' && s.pdf === 'proposta_2028')).toBe(true);
  });

  it('correção do dia ("na verdade dia 15") substitui o dia da data antiga', () => {
    const r = decidir(
      conversaEm('proposta_enviada', { diaSemana: 'sabado', convidados: 200, data: '2027-10-30', ano: 2027 }),
      nlu({ slots: { dia: 15 } }),
      ctx,
    );
    expect(dataCompleta(r.conversa.slots)).toBe('2027-10-15');
  });
});

describe('data concreta manda no dia da semana', () => {
  it('preferência "dia de semana" + data que cai num sábado NÃO vira mini (cobra valor cheio)', () => {
    // 2027-03-13 é sábado. Antes, a preferência declarada ganhava da data real
    // e um casamento de sábado recebia proposta de mini wedding.
    const r = decidir(
      conversaEm('aguardando_qualificacao', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ slots: { data: '2027-03-13' } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
  });

  it('com a data completa já sabida, não pergunta "sábado/domingo ou dia de semana"', () => {
    // 2027-03-15 é segunda: o dia da semana sai da própria data.
    const r = decidir(
      conversaEm('aguardando_qualificacao', { convidados: 50 }),
      nlu({ slots: { data: '2027-03-15' } }),
      ctx,
    );
    expect(r.saidas.some((s) => /sábado\/domingo/.test(s.texto ?? ''))).toBe(false);
    expect(r.conversa.estado).toBe('aguardando_interesse_mini'); // segunda + 50 = mini
  });
});

describe('mini wedding — correção de dados no aceite', () => {
  it('resposta com dado que tira do mini ("na verdade sábado, 2027") re-cota no fluxo normal', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ slots: { diaSemana: 'sabado', ano: 2027 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
    expect(r.saidas.some((s) => /mini/i.test(s.texto ?? ''))).toBe(false);
  });

  it('mais de 80 convidados no aceite também sai do mini', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ slots: { convidados: 150 } }),
      ctx,
    );
    // continua no fluxo normal (falta o ano -> pergunta a data/ano)
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(r.saidas.some((s) => /mini/i.test(s.texto ?? ''))).toBe(false);
  });

  it('aceite do mini com data OCUPADA avisa em vez de mandar a proposta', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { diaSemana: 'segunda', convidados: 50, data: '2027-03-15', ano: 2027 }),
      nlu({ afirmativo: true }),
      { agora: AGORA, disponibilidadeData: { data: '2027-03-15', livre: false, alternativa: '2027-03-22' } },
    );
    expect(r.conversa.estado).toBe('aguardando_interesse_mini');
    expect(r.saidas[0]?.texto).toMatch(/reservada/i);
    expect(r.saidas.some((s) => s.tipo === 'pdf')).toBe(false);
  });
});

describe('dúvida/negociação no primeiro contato', () => {
  it('fora_do_script na 1ª mensagem repassa a pergunta (não engole) e NÃO manda o vídeo', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'fora_do_script' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/fora do script/i);
    expect(r.saidas.some((s) => s.tipo === 'video')).toBe(false);
    expect(r.saidas.at(-1)?.texto).toMatch(/já te respondo/i);
  });

  it('fora_do_script junto de dado de orçamento: também sem vídeo (pode ser cliente fechada)', () => {
    const r = decidir(
      conversaEm('novo'),
      nlu({ intencao: 'fora_do_script', slots: { mesDia: '08-21', convidados: 150 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto']);
    expect(r.saidas[0]?.texto).toMatch(/já te respondo/i);
  });

  it('negociar na 1ª mensagem idem', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'negociar' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/negociar/i);
  });
});

describe('coleta do nome da noiva', () => {
  it('o nome dito na 1ª mensagem é guardado (a abertura é fixa e não o usa)', () => {
    const r = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Ester' }), ctx);
    expect(r.conversa.slots.nome).toBe('Ester');
    expect(r.saidas[0]?.texto).toMatch(/Me chamo Raquel/);
    expect(r.saidas[0]?.texto).not.toMatch(/com quem/i);
  });

  it('a abertura não pergunta o nome (texto da Raquel, 14/10/2026)', () => {
    const r = decidir(conversaEm('novo'), nlu(), ctx);
    expect(r.saidas[0]?.texto).not.toMatch(/com quem eu falo/i);
  });

  it('o nome fica guardado nos slots entre turnos', () => {
    const t1 = decidir(conversaEm('novo'), nlu({ nomeDetectado: 'Ana' }), ctx);
    const t2 = decidir(t1.conversa, nlu({ slots: { diaSemana: 'sabado', convidados: 200, ano: 2027 } }), ctx);
    expect(t2.conversa.slots.nome).toBe('Ana');
    expect(t2.conversa.estado).toBe('proposta_enviada');
  });
});

describe('fornecedor / não-noiva', () => {
  it('acusa o recebimento e transborda já no primeiro contato (sem quebrar a persona)', () => {
    const r = decidir(conversaEm('novo'), nlu({ intencao: 'fornecedor' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.conversa.motivoHandoff).toMatch(/fornecedor/i);
    expect(r.saidas[0]?.texto).toMatch(/um instante/i);
    // a persona É a Raquel: nunca dizer "vou chamar a Raquel"
    expect(r.saidas[0]?.texto).not.toMatch(/Raquel/);
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

describe('mini wedding não vale em feriado nem véspera (regra obrigatória)', () => {
  const AGORA_2026 = '2026-10-15T12:00:00.000Z';
  const ctx26: ContextoDecisao = { agora: AGORA_2026 };

  it('7 de setembro de 2027 (terça, feriado) com 40 pessoas vai para a proposta normal, não para o mini', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { data: '2027-09-07', ano: 2027, convidados: 40 } }),
      ctx26,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.some((s) => /mini wedding/i.test(s.texto ?? ''))).toBe(false);
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
  });

  it('véspera (6/9/2027, segunda) também não é mini', () => {
    expect(ehMiniWedding({ data: '2027-09-06', ano: 2027, convidados: 40 })).toBe(false);
  });

  it('feriado móvel: Corpus Christi (27/5/2027) e a véspera (26/5)', () => {
    expect(ehMiniWedding({ data: '2027-05-27', ano: 2027, convidados: 40 })).toBe(false);
    expect(ehMiniWedding({ data: '2027-05-26', ano: 2027, convidados: 40 })).toBe(false);
  });

  it('dia comum de semana continua sendo mini', () => {
    expect(ehMiniWedding({ data: '2028-03-15', ano: 2028, convidados: 40 })).toBe(true);
  });

  it('só dia e mês (sem ano): feriado de data fixa já impede o mini', () => {
    expect(ehMiniWedding({ mesDia: '09-07', convidados: 40, preferenciaDia: 'dia_de_semana' })).toBe(false);
    expect(ehMiniWedding({ mesDia: '03-15', convidados: 40, preferenciaDia: 'dia_de_semana' })).toBe(true);
  });

  it('dia de semana sem data (só "durante a semana") continua oferecendo o mini, que traz a regra no texto', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao'),
      nlu({ slots: { preferenciaDia: 'dia_de_semana', convidados: 40 } }),
      ctx26,
    );
    expect(r.conversa.estado).toBe('aguardando_interesse_mini');
    expect(r.saidas[0]?.texto).toMatch(/exceto feriados ou vésperas/);
  });

  it('aceitar o mini com uma data que é feriado muda para a proposta normal', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { preferenciaDia: 'dia_de_semana', convidados: 40 }),
      nlu({ slots: { data: '2027-09-07', ano: 2027 } }),
      ctx26,
    );
    expect(r.saidas.some((s) => s.pdf === 'proposta_mini')).toBe(false);
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
  });
});

describe('mini: indecisa e pergunta sobre o mini', () => {
  const slotsMini = { diaSemana: 'segunda', convidados: 30, ano: 2028 } as const;

  it('"vou ver com meu noivo" recebe o PDF do mini (não a pergunta das tradicionais)', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini', slotsMini), nlu({ indeciso: true, negativo: true }), ctx);
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf', 'texto']);
    expect(r.saidas[1]?.pdf).toBe('proposta_mini');
    expect(r.conversa.estado).toBe('proposta_enviada');
  });

  it('pergunta fora do roteiro sobre o mini ("tem hospedagem?") recebe o PDF e passa para a Raquel', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini', slotsMini), nlu({ intencao: 'fora_do_script' }), ctx);
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'pdf']);
    expect(r.saidas[1]?.pdf).toBe('proposta_mini');
    expect(r.saidas[0]?.texto).toBe('Segue nosso PDF de mini wedding com as informações:');
  });
});

describe('convite de visita depois da proposta', () => {
  it('"ok" e "sim" depois da proposta pedem o dia da visita', () => {
    for (const afirmativo of [true]) {
      const r = decidir(conversaEm('proposta_enviada'), nlu({ afirmativo }), ctx);
      expect(r.conversa.estado).toBe('aguardando_pref_visita');
    }
  });

  it('o convite sai depois de qualquer proposta, nunca antes do PDF', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 150 }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    const tipos = r.saidas.map((s) => s.tipo);
    expect(tipos.lastIndexOf('texto')).toBeGreaterThan(tipos.indexOf('pdf'));
  });
});

describe('visita fora do horário anunciado: abre exceção em vez de recusar', () => {
  const pedir = (visita: Parameters<typeof nlu>[0] extends infer P ? P : never) =>
    decidir(conversaEm('aguardando_pref_visita'), nlu(visita), ctx);

  it('domingo às 15h', () => {
    const r = pedir({ visita: { dataHora: 'domingo às 15h' } });
    expect(r.conversa.estado).toBe('handoff');
    expect(r.saidas[0]?.texto).toBe(
      'Entendi! Vou ver aqui com a equipe se conseguimos abrir uma exceção para domingo às 15h e já te retorno, ok? ☺️',
    );
    expect(r.saidas[0]?.humanizar).toBeFalsy();
    expect(r.conversa.motivoHandoff).toMatch(/FORA DO HORÁRIO/);
    expect(r.conversa.motivoHandoff).toMatch(/domingo às 15h/);
  });

  it('sábado às 16h (depois das 13h)', () => {
    const r = pedir({ visita: { diaSemana: 'sabado', dataHora: 'sábado às 16h' } });
    expect(r.conversa.motivoHandoff).toMatch(/FORA DO HORÁRIO/);
    expect(r.saidas[0]?.texto).toMatch(/exceção/);
  });

  it('só a preferência "domingo de manhã" também é fora', () => {
    const r = pedir({ visita: { diaSemana: 'domingo', periodo: 'manha' } });
    expect(r.saidas[0]?.texto).toMatch(/exceção para domingo de manhã/);
  });

  it('sábado de tarde (preferência sem hora) é fora', () => {
    const r = pedir({ visita: { diaSemana: 'sabado', periodo: 'tarde' } });
    expect(r.conversa.motivoHandoff).toMatch(/FORA DO HORÁRIO/);
  });

  it('dia de semana depois das 18h é fora', () => {
    const r = pedir({ visita: { dataHora: 'quarta às 19h' } });
    expect(r.conversa.motivoHandoff).toMatch(/FORA DO HORÁRIO/);
  });

  it('dentro do horário segue o fluxo normal: sábado às 10h e quinta às 15h', () => {
    expect(pedir({ visita: { dataHora: 'sábado às 10h' } }).saidas[0]?.texto).toMatch(/^Perfeito, anotei sábado às 10h/);
    expect(pedir({ visita: { dataHora: 'quinta às 15h' } }).saidas[0]?.texto).toMatch(/^Perfeito, anotei quinta às 15h/);
    expect(pedir({ visita: { diaSemana: 'sabado', periodo: 'manha' } }).conversa.motivoHandoff).not.toMatch(/FORA/);
  });

  it('sem dia nem hora ("qualquer dia") não é fora', () => {
    const r = pedir({ visita: { indiferente: true } });
    expect(r.conversa.motivoHandoff).not.toMatch(/FORA/);
  });
});

describe('proposta enviada: dado reemitido pelo modelo não gera nova cotação', () => {
  const slots = { ano: 2028, diaSemana: 'sabado', convidados: 150 } as const;

  it('mesmos dados (o modelo reemitiu os "dados já coletados"): não re-cota, trata a intenção', () => {
    const r = decidir(
      conversaEm('proposta_enviada', slots),
      nlu({ intencao: 'agendar_visita', slots: { ano: 2028, diaSemana: 'sabado', convidados: 150 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas.some((s) => s.tipo === 'pdf')).toBe(false);
  });

  it('dado que muda (outro ano) continua re-cotando', () => {
    const r = decidir(conversaEm('proposta_enviada', slots), nlu({ slots: { ano: 2027 } }), ctx);
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2027');
  });

  it('o mesmo vale depois de encerrar', () => {
    const r = decidir(conversaEm('encerrada', slots), nlu({ slots: { ano: 2028 } }), ctx);
    expect(r.saidas).toHaveLength(0);
  });
});

describe('mesclarSlots: dia da semana novo que contradiz o antigo substitui o antigo', () => {
  it('"quarta" antiga + só a preferência "fim de semana" nova: passa a ser fim de semana', () => {
    const r = mesclarSlots({ diaSemana: 'quarta', preferenciaDia: 'dia_de_semana' }, { preferenciaDia: 'fim_de_semana' });
    expect(classificarDia(r)).toBe('fim_de_semana');
    expect(r.diaSemana).toBeUndefined();
  });

  it('preferência nova que concorda com o dia antigo não apaga o dia', () => {
    const r = mesclarSlots({ diaSemana: 'quarta' }, { preferenciaDia: 'dia_de_semana' });
    expect(r.diaSemana).toBe('quarta');
  });

  it('dia da semana novo substitui a preferência genérica antiga', () => {
    const r = mesclarSlots({ diaSemana: 'quarta', preferenciaDia: 'dia_de_semana' }, { diaSemana: 'sabado' });
    expect(r.diaSemana).toBe('sabado');
    expect(r.preferenciaDia).toBeUndefined();
    expect(classificarDia(r)).toBe('fim_de_semana');
  });

  it('data completa antiga numa quarta + "prefiro sábado": a data velha sai, o ano fica', () => {
    const r = mesclarSlots({ data: '2028-03-15', ano: 2028, diaSemana: 'quarta' }, { diaSemana: 'sabado' });
    expect(r.data).toBeUndefined();
    expect(r.ano).toBe(2028);
    expect(classificarDia(r)).toBe('fim_de_semana');
  });

  it('data nova na mesma mensagem vence normalmente', () => {
    const r = mesclarSlots({ diaSemana: 'quarta' }, { data: '2028-03-18', diaSemana: 'sabado' });
    expect(r.data).toBe('2028-03-18');
    expect(classificarDia(r)).toBe('fim_de_semana');
  });

  it('na oferta do mini, "prefiro sábado" que o modelo devolveu só como preferência manda a proposta normal', () => {
    const r = decidir(
      conversaEm('aguardando_interesse_mini', { ano: 2028, diaSemana: 'quarta', preferenciaDia: 'dia_de_semana', convidados: 50 }),
      nlu({ negativo: true, slots: { preferenciaDia: 'fim_de_semana' } }),
      ctx,
    );
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
    expect(r.saidas.some((s) => s.pdf === 'proposta_mini')).toBe(false);
  });
});
