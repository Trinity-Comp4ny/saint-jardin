import { describe, expect, it } from 'vitest';
import { decidir, novaConversa, resumoEvento, type ContextoDecisao } from '../src/domain/stateMachine';
import { ajustarEntrada } from '../src/domain/intencoesDeterministicas';
import { MSG } from '../src/domain/persona';
import { GeminiNLU } from '../src/adapters/GeminiNLU';
import type { Conversa, EntradaNLU, Intencao } from '../src/domain/types';

const AGORA = '2026-10-15T15:00:00.000Z';
const ctx: ContextoDecisao = { agora: AGORA };
const nlu = (p: Partial<EntradaNLU> = {}): EntradaNLU => ({ slots: {}, intencao: 'seguir_fluxo', ...p });
const conversaEm = (estado: Conversa['estado'], slots: Conversa['slots'] = {}): Conversa => ({
  ...novaConversa('5511999', AGORA),
  estado,
  slots,
});
const tipos = (r: { saidas: { tipo: string }[] }) => r.saidas.map((s) => s.tipo);

describe('ajustarEntrada: ano que a agenda ainda não abriu', () => {
  const e = (texto: string, intencao: Intencao = 'seguir_fluxo', estado: Conversa['estado'] = 'aguardando_qualificacao') =>
    ajustarEntrada(texto, estado, { slots: {}, intencao });

  it.each(['2029, sábado, 100 pessoas', 'queria para 2029', 'dia 15/03/2029', 'e para 2029?'])('"%s" marca 2029', (texto) => {
    expect(e(texto).anoIndisponivel).toBe(2029);
  });

  it('o modelo que chamou de fora_do_script volta a ser seguir_fluxo', () => {
    expect(e('2029, sábado', 'fora_do_script').intencao).toBe('seguir_fluxo');
  });

  it('citou 2028 também ("2028 ou 2029"): fica com o que vendemos, sem aviso', () => {
    expect(e('pode ser 2028 ou 2029').anoIndisponivel).toBeUndefined();
  });

  it('2030 em diante vai para a Raquel (fora_do_script), sem aviso de 2029', () => {
    const r = e('queria para 2030');
    expect(r.anoIndisponivel).toBeUndefined();
    expect(r.intencao).toBe('fora_do_script');
  });

  it('2026 e 2027/2028 não mudam nada aqui', () => {
    expect(e('dezembro de 2026').anoIndisponivel).toBeUndefined();
    expect(e('2027').anoIndisponivel).toBeUndefined();
  });

  it('número que não é ano não dispara ("R$ 2.029" e "20290")', () => {
    expect(e('o valor de 20290 reais').anoIndisponivel).toBeUndefined();
  });
});

describe('pediu 2029: avisa e usa 2028 como base', () => {
  it('dia e convidados já sabidos: aviso, mensagem de ano 2028, PDF 2028 e convite', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 150 }),
      nlu({ anoIndisponivel: 2029 }),
      ctx,
    );
    expect(tipos(r)).toEqual(['texto', 'texto', 'pdf', 'texto']);
    expect(r.saidas[0]?.texto).toBe(MSG.agenda2029);
    expect(r.saidas[0]?.texto).toMatch(/agenda de 2029 em janeiro de 2027/);
    expect(r.saidas[0]?.texto).toMatch(/valores de 2028/);
    expect(r.saidas[0]?.humanizar).toBeFalsy();
    expect(r.saidas[2]?.pdf).toBe('proposta_2028');
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.conversa.slots.ano).toBe(2028);
    expect(r.conversa.slots.anoSolicitado).toBe(2029);
  });

  it('primeiro contato pedindo 2029: abertura e vídeo primeiro, o aviso depois, e pergunta o que falta', () => {
    const r = decidir(conversaEm('novo'), nlu({ anoIndisponivel: 2029 }), ctx);
    expect(tipos(r)).toEqual(['texto', 'video', 'texto', 'texto']);
    expect(r.saidas[0]?.texto).toMatch(/Me chamo Raquel/);
    expect(r.saidas[2]?.texto).toBe(MSG.agenda2029);
    expect(r.saidas[3]?.texto).toMatch(/convidados/);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('dia de semana com 50 convidados: aviso e depois a oferta do mini (que vale para 2027 e 2028)', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'quarta', convidados: 50 }),
      nlu({ anoIndisponivel: 2029 }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toBe(MSG.agenda2029);
    expect(r.saidas[1]?.texto).toBe(MSG.ofertaMini);
    expect(r.conversa.estado).toBe('aguardando_interesse_mini');
  });

  it('depois da proposta de 2028, "e para 2029?" só recebe o aviso (não reenvia o PDF)', () => {
    const r = decidir(
      conversaEm('proposta_enviada', { ano: 2028, diaSemana: 'sabado', convidados: 150 }),
      nlu({ anoIndisponivel: 2029 }),
      ctx,
    );
    expect(tipos(r)).toEqual(['texto']);
    expect(r.saidas[0]?.texto).toBe(MSG.agenda2029);
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.conversa.slots.anoSolicitado).toBe(2029);
  });

  it('depois da proposta de 2027, "e para 2029?" recebe o aviso e a proposta de 2028', () => {
    const r = decidir(
      conversaEm('proposta_enviada', { ano: 2027, diaSemana: 'sabado', convidados: 150 }),
      nlu({ anoIndisponivel: 2029 }),
      ctx,
    );
    expect(r.saidas[0]?.texto).toBe(MSG.agenda2029);
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
  });

  it('o aviso sai uma vez: pedir 2029 de novo não repete', () => {
    const t1 = decidir(conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 150 }), nlu({ anoIndisponivel: 2029 }), ctx);
    const t2 = decidir(t1.conversa, nlu({ anoIndisponivel: 2029 }), ctx);
    expect(t2.saidas.some((s) => s.texto === MSG.agenda2029)).toBe(false);
  });

  it('o alerta da Raquel mostra o ano que a noiva queria', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados: 150 }),
      nlu({ anoIndisponivel: 2029 }),
      ctx,
    );
    expect(resumoEvento(r.conversa.slots)).toMatch(/pediu 2029 \(recebeu os valores de 2028\)/);
  });

  it('conversa em handoff continua em silêncio', () => {
    const r = decidir(conversaEm('handoff'), nlu({ anoIndisponivel: 2029 }), ctx);
    expect(r.saidas).toHaveLength(0);
  });
});

describe('acima de 240 convidados: manda o orçamento (decisão da Raquel)', () => {
  it.each([241, 300, 500, 1000])('%i convidados num sábado recebem a proposta normal', (convidados) => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { diaSemana: 'sabado', convidados }),
      nlu({ slots: { ano: 2028 } }),
      ctx,
    );
    expect(r.conversa.estado).toBe('proposta_enviada');
    expect(r.saidas.find((s) => s.tipo === 'pdf')?.pdf).toBe('proposta_2028');
    // Sem aviso nem handoff: se a noiva tiver dúvida, a Raquel explica depois.
    expect(r.saidas.some((s) => /240|sentad/i.test(s.texto ?? ''))).toBe(false);
  });
});

describe('GeminiNLU: 2029 mesmo quando o modelo descarta o ano', () => {
  it('o schema só aceita 2027/2028: a regra marca 2029 sozinha', async () => {
    const n = new GeminiNLU('chave-falsa');
    (n as unknown as { client: unknown }).client = {
      models: { generateContent: async () => ({ text: '{"intencao":"fora_do_script","slots":{"ano":2029,"diaSemana":"sabado","convidados":100}}' }) },
    };
    const r = await n.analisar('2029, sábado, 100 pessoas', conversaEm('aguardando_qualificacao'));
    expect(r.slots.ano).toBeUndefined();
    expect(r.anoIndisponivel).toBe(2029);
    expect(r.intencao).toBe('seguir_fluxo');
  });
});
