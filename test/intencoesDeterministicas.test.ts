import { describe, expect, it } from 'vitest';
import { ajustarEntrada, completarVisita } from '../src/domain/intencoesDeterministicas';
import { horaNoTexto, visitaForaDoHorario } from '../src/domain/visita';
import type { EntradaNLU, Intencao } from '../src/domain/types';

const entrada = (intencao: Intencao = 'seguir_fluxo', extra: Partial<EntradaNLU> = {}): EntradaNLU => ({
  slots: {},
  intencao,
  ...extra,
});

describe('ajustarEntrada: cliente fechada', () => {
  it.each([
    'Oi, sou a Bruna, noiva do dia 21/08, tenho uma dúvida sobre meu pagamento',
    'queria ver a data da minha parcela',
    'preciso mudar uma cláusula do nosso contrato',
    'já fechamos com vocês, queria alterar o horário',
    'já somos clientes e queria uma segunda via do boleto',
  ])('"%s" vira cliente_fechado mesmo se o modelo disse outra coisa', (texto) => {
    for (const modelo of ['seguir_fluxo', 'fora_do_script', 'negociar'] as const) {
      expect(ajustarEntrada(texto, 'novo', entrada(modelo)).intencao).toBe('cliente_fechado');
    }
  });

  it.each([
    'Qual a forma de pagamento de vocês?',
    'já fechamos o buffet, falta só o espaço',
    'queria orçar um casamento para 2028',
  ])('"%s" NÃO vira cliente_fechado (é noiva ainda decidindo)', (texto) => {
    expect(ajustarEntrada(texto, 'novo', entrada('seguir_fluxo')).intencao).toBe('seguir_fluxo');
  });
});

describe('ajustarEntrada: evento que não é casamento', () => {
  it.each([
    'Boa tarde, queria orçamento para um evento corporativo da nossa empresa',
    'vocês fazem festa de 15 anos?',
    'queria orçar um aniversário de 50 anos',
    'estamos organizando uma formatura',
  ])('"%s" vai para a Raquel (fora_do_script) no primeiro contato', (texto) => {
    expect(ajustarEntrada(texto, 'novo', entrada('seguir_fluxo')).intencao).toBe('fora_do_script');
  });

  it('se fala de casamento junto, não muda ("trabalho numa empresa, vamos casar em 2028")', () => {
    expect(ajustarEntrada('trabalho numa empresa e vamos casar em 2028', 'novo', entrada('seguir_fluxo')).intencao).toBe(
      'seguir_fluxo',
    );
  });

  it('só vale no começo da conversa (depois da proposta não mexe)', () => {
    expect(ajustarEntrada('queria um evento corporativo também', 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe(
      'seguir_fluxo',
    );
  });
});

describe('ajustarEntrada: pergunta de preço é pedido de orçamento', () => {
  it.each(['qual o valor do aluguel?', 'quanto custa casar aí?', 'me passa a tabela de preços', 'queria uma cotação'])(
    '"%s" no começo vira seguir_fluxo',
    (texto) => {
      expect(ajustarEntrada(texto, 'aguardando_assunto', entrada('fora_do_script')).intencao).toBe('seguir_fluxo');
    },
  );

  it('depois da proposta uma pergunta de valor continua indo para a Raquel', () => {
    expect(ajustarEntrada('qual o valor do pacote 3?', 'proposta_enviada', entrada('fora_do_script')).intencao).toBe(
      'fora_do_script',
    );
  });

  it('negociação não é reclassificada', () => {
    expect(ajustarEntrada('tem desconto no valor?', 'novo', entrada('negociar')).intencao).toBe('negociar');
  });
});

describe('ajustarEntrada: problema com o material', () => {
  it.each([
    'pode me mandar o valor aqui no texto? não consegui abrir o pdf',
    'o vídeo não carrega aqui',
    'manda o valor por texto por favor',
    'o arquivo veio com erro',
  ])('"%s" vira fora_do_script (alerta a Raquel em vez de silêncio)', (texto) => {
    expect(ajustarEntrada(texto, 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe('fora_do_script');
  });

  it('comentário solto continua sem handoff', () => {
    expect(ajustarEntrada('kkkk que lindo o espaço!', 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe(
      'seguir_fluxo',
    );
  });
});

describe('ajustarEntrada: indeciso', () => {
  it.each(['vou ver com meu noivo', 'vou pensar', 'preciso conversar com minha família', 'deixa eu ver com a minha mãe'])(
    '"%s"',
    (texto) => {
      expect(ajustarEntrada(texto, 'aguardando_interesse_mini', entrada('seguir_fluxo', { negativo: true })).indeciso).toBe(
        true,
      );
    },
  );

  it('"sim, vou ver com meu noivo" não é indeciso (aceitou)', () => {
    expect(ajustarEntrada('sim, pode mandar, vou ver com meu noivo', 'aguardando_interesse_mini', entrada('seguir_fluxo', { afirmativo: true })).indeciso).toBeUndefined();
  });

  it('recusa seca não é indeciso', () => {
    expect(ajustarEntrada('não', 'aguardando_interesse_mini', entrada('seguir_fluxo', { negativo: true })).indeciso).toBeUndefined();
  });
});

describe('visita: completar o que o modelo não pegou', () => {
  it('"sábado às 10h" sem dataHora vira dataHora', () => {
    expect(completarVisita('sábado às 10h', { diaSemana: 'sabado' })).toEqual({ diaSemana: 'sabado', dataHora: 'sábado às 10h' });
  });

  it('o que o modelo já preencheu não é trocado', () => {
    expect(completarVisita('domingo às 15h', { dataHora: 'dia 12 às 10h' }).dataHora).toBe('dia 12 às 10h');
  });

  it('sem hora, não inventa dataHora', () => {
    expect(completarVisita('qualquer dia', undefined)).toEqual({});
  });

  it('aplica só no estado de preferência de visita', () => {
    const e = ajustarEntrada('domingo às 15h', 'aguardando_pref_visita', entrada('seguir_fluxo'));
    expect(e.visita).toEqual({ diaSemana: 'domingo', dataHora: 'domingo às 15h' });
  });
});

describe('horaNoTexto', () => {
  it.each([
    ['sábado às 10h', 10],
    ['às 16:30', 16],
    ['3 da tarde', undefined], // sem "h" nem "às": não arrisca
    ['às 3 da tarde', 15],
    ['meio-dia', 12],
    ['dia 12 às 9h', 9],
    ['dia 12', undefined],
    ['12/10', undefined],
  ])('"%s" -> %s', (texto, esperado) => {
    expect(horaNoTexto(texto)).toBe(esperado);
  });
});

describe('visitaForaDoHorario', () => {
  const AGORA = '2026-10-15T15:00:00.000Z';

  it('domingo sempre é fora', () => {
    expect(visitaForaDoHorario({ diaSemana: 'domingo' }, AGORA)).toEqual({ quando: 'domingo' });
  });

  it('sábado vale das 8h até antes das 13h', () => {
    expect(visitaForaDoHorario({ dataHora: 'sábado às 8h' }, AGORA)).toBeUndefined();
    expect(visitaForaDoHorario({ dataHora: 'sábado às 12h' }, AGORA)).toBeUndefined();
    expect(visitaForaDoHorario({ dataHora: 'sábado às 13h' }, AGORA)).toBeDefined();
    expect(visitaForaDoHorario({ dataHora: 'sábado às 7h' }, AGORA)).toBeDefined();
  });

  it('seg a sex vale das 8h até antes das 18h', () => {
    expect(visitaForaDoHorario({ dataHora: 'terça às 17h' }, AGORA)).toBeUndefined();
    expect(visitaForaDoHorario({ dataHora: 'terça às 18h' }, AGORA)).toBeDefined();
  });

  it('pela data: 17/10/2026 é sábado, 18/10/2026 é domingo', () => {
    expect(visitaForaDoHorario({ dataHora: '17/10 às 10h' }, AGORA)).toBeUndefined();
    expect(visitaForaDoHorario({ dataHora: '17/10 às 15h' }, AGORA)).toBeDefined();
    expect(visitaForaDoHorario({ dataHora: '18/10 às 10h' }, AGORA)).toBeDefined();
  });

  it('só o período: tarde de sábado é fora, manhã de sábado não', () => {
    expect(visitaForaDoHorario({ diaSemana: 'sabado', periodo: 'tarde' }, AGORA)).toBeDefined();
    expect(visitaForaDoHorario({ diaSemana: 'sabado', periodo: 'manha' }, AGORA)).toBeUndefined();
  });

  it('"da noite" é fora em qualquer dia', () => {
    expect(visitaForaDoHorario({ dataHora: 'quarta às 8 da noite' }, AGORA)).toBeDefined();
  });

  it('indiferente ou sem informação não é fora', () => {
    expect(visitaForaDoHorario({ indiferente: true }, AGORA)).toBeUndefined();
    expect(visitaForaDoHorario({}, AGORA)).toBeUndefined();
  });
});

describe('ajustarEntrada: visita técnica e anos que o bot não vende', () => {
  it.each([
    'Sou do buffet do casamento da Ana, dia 15/12/2027, queria agendar a visita técnica',
    'Sou decoradora do casamento da Ana e preciso fazer a visita tecnica',
  ])('"%s" cai no fluxo de visita técnica mesmo se o modelo disse fornecedor', (texto) => {
    for (const modelo of ['fornecedor', 'seguir_fluxo', 'fora_do_script'] as const) {
      expect(ajustarEntrada(texto, 'novo', entrada(modelo)).intencao).toBe('visita_tecnica');
    }
  });

  it('"2029, sábado, 100 pessoas": o modelo disse fora_do_script, mas é resposta à data', () => {
    const e = ajustarEntrada('2029, sábado, 100 pessoas', 'aguardando_qualificacao', {
      slots: { diaSemana: 'sabado', convidados: 100 },
      intencao: 'fora_do_script',
    });
    expect(e.intencao).toBe('seguir_fluxo');
  });

  it('um ano solto sem dados de orçamento não é reclassificado (pode ser outra pergunta)', () => {
    const e = ajustarEntrada('vocês já funcionavam em 2019?', 'aguardando_qualificacao', entrada('fora_do_script'));
    expect(e.intencao).toBe('fora_do_script');
  });
});

describe('ajustarEntrada: despedida depois da proposta e preço na oferta do mini', () => {
  it.each([
    'obrigada, vou olhar com calma',
    'obrigado! depois eu volto',
    'vou analisar com calma e te falo',
    'qualquer coisa eu te chamo',
  ])('"%s" depois da proposta é despedida', (texto) => {
    expect(ajustarEntrada(texto, 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe('despedida');
  });

  it('uma pergunta junto não é despedida', () => {
    expect(ajustarEntrada('obrigada, vou olhar. Tem desconto?', 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe(
      'seguir_fluxo',
    );
    expect(ajustarEntrada('obrigada! vou olhar com calma, posso levar meu buffet?', 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe(
      'seguir_fluxo',
    );
  });

  it('na oferta do mini, "vou ver com meu noivo" continua indecisão (recebe o PDF), não despedida', () => {
    const e = ajustarEntrada('obrigada, vou ver com meu noivo', 'aguardando_interesse_mini', entrada('seguir_fluxo'));
    expect(e.intencao).toBe('seguir_fluxo');
    expect(e.indeciso).toBe(true);
  });

  it('"quanto é?" na oferta do mini é pedido de informação, não pergunta fora do roteiro', () => {
    expect(ajustarEntrada('quanto é?', 'aguardando_interesse_mini', entrada('fora_do_script')).intencao).toBe('seguir_fluxo');
    expect(ajustarEntrada('qual o valor desse pacote?', 'aguardando_interesse_mini', entrada('fora_do_script')).intencao).toBe('seguir_fluxo');
  });

  it('"tem hospedagem?" na oferta do mini continua indo para a Raquel (com o PDF)', () => {
    expect(ajustarEntrada('tem hospedagem?', 'aguardando_interesse_mini', entrada('fora_do_script')).intencao).toBe('fora_do_script');
  });
});

describe('ajustarEntrada: cumprimento puro não inicia o fluxo', () => {
  it.each(['tudo bem?', 'Oi, tudo bem?', 'bom dia!', 'olá', 'e aí, tudo certo?'])(
    '"%s" enquanto o bot espera o assunto vira saudação mesmo se o modelo disse seguir_fluxo',
    (texto) => {
      expect(ajustarEntrada(texto, 'aguardando_assunto', entrada('seguir_fluxo')).intencao).toBe('saudacao');
      expect(ajustarEntrada(texto, 'novo', entrada('seguir_fluxo')).intencao).toBe('saudacao');
    },
  );

  it.each(['oi, queria um orçamento', 'tudo bem? queria saber os valores', 'bom dia, quero conhecer o espaço'])(
    '"%s" é pedido de verdade e segue o fluxo',
    (texto) => {
      expect(ajustarEntrada(texto, 'aguardando_assunto', entrada('seguir_fluxo')).intencao).toBe('seguir_fluxo');
    },
  );

  it('depois da proposta um "tudo bem?" não é reclassificado', () => {
    expect(ajustarEntrada('tudo bem?', 'proposta_enviada', entrada('seguir_fluxo')).intencao).toBe('seguir_fluxo');
  });
});

describe('ajustarEntrada: despedida na qualificação (resposta à retomada do orçamento)', () => {
  it.each(['agora não consigo, depois eu volto', 'obrigada, vou olhar com calma', 'depois eu te falo'])(
    '"%s" vira despedida mesmo se o modelo disse fora_do_script',
    (texto) => {
      for (const modelo of ['seguir_fluxo', 'fora_do_script'] as const) {
        expect(ajustarEntrada(texto, 'aguardando_qualificacao', entrada(modelo)).intencao).toBe('despedida');
      }
    },
  );

  it('com pergunta no meio não é despedida', () => {
    expect(ajustarEntrada('depois eu volto, mas vocês têm hospedagem?', 'aguardando_qualificacao', entrada('seguir_fluxo')).intencao).not.toBe('despedida');
  });

  it('no primeiro contato e na oferta do mini continua como antes', () => {
    expect(ajustarEntrada('depois eu volto', 'novo', entrada('seguir_fluxo')).intencao).toBe('seguir_fluxo');
    expect(ajustarEntrada('depois eu volto', 'aguardando_interesse_mini', entrada('fora_do_script')).intencao).toBe('fora_do_script');
  });
});
