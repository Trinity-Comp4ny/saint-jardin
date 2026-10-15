import { describe, expect, it } from 'vitest';
import { completarSlots } from '../src/domain/slotsDeterministicos';
import { GeminiNLU } from '../src/adapters/GeminiNLU';
import { novaConversa } from '../src/domain/stateMachine';
import type { Conversa } from '../src/domain/types';

// Mensagem real do teste de 15/10/2026 (duas mensagens agrupadas pela fila).
const MENSAGEM_REAL =
  'queria para 2028. A data exata ainda nao sei\nPrefiro um sábado e espero que a festa tenha cerca de 200 convidados.';

describe('completarSlots', () => {
  it('a mensagem real do teste: ano, sábado e 200 convidados mesmo se o LLM só devolveu o ano', () => {
    expect(completarSlots(MENSAGEM_REAL, 'aguardando_qualificacao', { ano: 2028 })).toEqual({
      ano: 2028,
      diaSemana: 'sabado',
      convidados: 200,
    });
  });

  it('o que o LLM preencheu vence, a regra só completa o vazio', () => {
    const r = completarSlots('sábado, 200 pessoas, 2028', 'aguardando_qualificacao', {
      diaSemana: 'domingo',
      convidados: 150,
      ano: 2027,
    });
    expect(r).toEqual({ diaSemana: 'domingo', convidados: 150, ano: 2027 });
  });

  it('com a preferência já lida pelo LLM, não força um dia da semana', () => {
    const r = completarSlots(MENSAGEM_REAL, 'aguardando_qualificacao', {
      ano: 2028,
      preferenciaDia: 'fim_de_semana',
    });
    expect(r).toEqual({ ano: 2028, preferenciaDia: 'fim_de_semana', convidados: 200 });
  });

  it('"sábado ou domingo" vira preferência de fim de semana, não um dia só', () => {
    expect(completarSlots('pode ser sábado ou domingo', 'aguardando_qualificacao', {})).toEqual({
      preferenciaDia: 'fim_de_semana',
    });
  });

  it('dia de semana genérico', () => {
    expect(completarSlots('durante a semana, uns 40 convidados', 'novo', {})).toEqual({
      preferenciaDia: 'dia_de_semana',
      convidados: 40,
    });
  });

  it('dois anos citados é ambíguo: não escolhe', () => {
    expect(completarSlots('2027 ou 2028, não sei', 'aguardando_qualificacao', {})).toEqual({});
  });

  it('número pequeno não é convidados ("2 pessoas") e exagero também não', () => {
    expect(completarSlots('somos 2 pessoas', 'aguardando_qualificacao', {})).toEqual({});
    expect(completarSlots('99999 convidados', 'aguardando_qualificacao', {})).toEqual({});
  });

  it('dia da semana só vale onde ela fala do dia do evento (não na proposta enviada)', () => {
    expect(completarSlots('posso visitar sábado?', 'proposta_enviada', {})).toEqual({});
  });

  it('nos estados de visita não extrai nada (os números/dias são da visita)', () => {
    expect(completarSlots('sábado, 2028, 30 pessoas', 'aguardando_pref_visita', {})).toEqual({});
    expect(completarSlots('terça, 30 pessoas', 'visita_tecnica_data', {})).toEqual({});
  });

  it('"uns 40" / "cerca de 120" sem a palavra "pessoas" contam como convidados enquanto qualifica', () => {
    expect(completarSlots('durante a semana, uns 40', 'aguardando_qualificacao', {}).convidados).toBe(40);
    expect(completarSlots('cerca de 120, sábado', 'novo', {}).convidados).toBe(120);
    expect(completarSlots('mais ou menos 80', 'aguardando_qualificacao', {}).convidados).toBe(80);
  });

  it('a aproximação não pega hora, ano, data nem fora da qualificação', () => {
    expect(completarSlots('uns 10h', 'aguardando_qualificacao', {}).convidados).toBeUndefined();
    expect(completarSlots('cerca de 2028', 'aguardando_qualificacao', {}).convidados).toBeUndefined();
    expect(completarSlots('umas 15 dias antes', 'aguardando_qualificacao', {}).convidados).toBeUndefined();
    expect(completarSlots('uns 40', 'proposta_enviada', {}).convidados).toBeUndefined();
  });

  it('não inventa nada de uma mensagem sem dado', () => {
    expect(completarSlots('queria uma cotacao', 'novo', {})).toEqual({});
  });
});

describe('GeminiNLU com o piso determinístico', () => {
  const conversa: Conversa = { ...novaConversa('5511', '2026-10-15T13:00:00Z'), estado: 'aguardando_qualificacao' };

  function nluComResposta(texto: string): GeminiNLU {
    const nlu = new GeminiNLU('chave-falsa');
    (nlu as unknown as { client: unknown }).client = {
      models: { generateContent: async () => ({ text: texto }) },
    };
    return nlu;
  }

  it('o modelo devolve só o ano: completa sábado e convidados', async () => {
    const r = await nluComResposta('{"slots":{"ano":2028},"intencao":"seguir_fluxo"}').analisar(
      MENSAGEM_REAL,
      conversa,
    );
    expect(r.slots).toEqual({ ano: 2028, diaSemana: 'sabado', convidados: 200 });
  });

  it('o modelo devolve lixo fora do schema: o piso ainda extrai e o erro é registrado', async () => {
    const erros: unknown[][] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => void erros.push(a);
    try {
      const r = await nluComResposta('{"intencao":"nao_existe"}').analisar(MENSAGEM_REAL, conversa);
      expect(r.intencao).toBe('seguir_fluxo');
      expect(r.slots).toEqual({ ano: 2028, diaSemana: 'sabado', convidados: 200 });
      expect(erros).toHaveLength(1);
      expect(String(erros[0]?.[0])).toMatch(/fora do schema/);
    } finally {
      console.error = original;
    }
  });

  it('o modelo acerta tudo: nada muda', async () => {
    const r = await nluComResposta(
      '{"slots":{"ano":2028,"diaSemana":"sabado","convidados":200},"intencao":"seguir_fluxo"}',
    ).analisar(MENSAGEM_REAL, conversa);
    expect(r.slots).toEqual({ ano: 2028, diaSemana: 'sabado', convidados: 200 });
  });
});
