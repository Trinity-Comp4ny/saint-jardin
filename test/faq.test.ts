import { describe, expect, it } from 'vitest';
import { decidir, novaConversa, type ContextoDecisao } from '../src/domain/stateMachine';
import { ajustarEntrada, duvidasNoTexto } from '../src/domain/intencoesDeterministicas';
import { MSG } from '../src/domain/persona';
import type { Conversa, EntradaNLU, Intencao } from '../src/domain/types';

const AGORA = '2026-10-16T12:00:00.000Z';
const ctx: ContextoDecisao = { agora: AGORA };
const conversaEm = (estado: Conversa['estado'], slots: Conversa['slots'] = {}): Conversa => ({
  ...novaConversa('5511999', AGORA),
  estado,
  slots,
});
// A leitura completa: modelo + rede determinística, como o GeminiNLU entrega.
const ler = (texto: string, estado: Conversa['estado'], intencao: Intencao = 'fora_do_script'): EntradaNLU =>
  ajustarEntrada(texto, estado, { slots: {}, intencao });
const textos = (r: { saidas: { texto?: string }[] }) => r.saidas.map((s) => s.texto);

describe('duvidasNoTexto', () => {
  it.each([
    ['vocês têm hospedagem?', ['hospedagem']],
    ['dá pra hospedar os convidados?', ['hospedagem']],
    ['tem suíte para a noiva se arrumar?', ['hospedagem']],
    ['os convidados podem dormir aí?', ['hospedagem']],
    ['vocês trabalham com pacotes fechados?', ['pacotes']],
    ['tem pacote de casamento?', ['pacotes']],
    ['o buffet está incluso?', ['pacotes']],
    ['o buffet e a decoração já estão inclusos?', ['pacotes']],
    ['Nossa eu amei! E a tabela de valores? Vocês tem hospedagens?', ['hospedagem', 'valores']],
  ])('"%s"', (texto, esperado) => {
    expect(duvidasNoTexto(texto)).toEqual(esperado);
  });

  it.each([
    'qual o valor do pacote 3?',
    'o espaço acomoda 200 pessoas?',
    'quero um orçamento para 2027',
    'qual o pacote de hospedagem?', // é hospedagem, não pacotes fechados
  ])('"%s" não marca pacotes', (texto) => {
    expect(duvidasNoTexto(texto)).not.toContain('pacotes');
  });
});

describe('ajustarEntrada: hospedagem e pacotes deixam de ser fora do script', () => {
  it('o modelo que disse fora_do_script volta a seguir_fluxo', () => {
    expect(ler('vocês têm hospedagem?', 'aguardando_qualificacao').intencao).toBe('seguir_fluxo');
    expect(ler('trabalham com pacotes fechados?', 'proposta_enviada').intencao).toBe('seguir_fluxo');
  });

  it('na oferta do mini a pergunta segue o caminho antigo (PDF do mini e Raquel)', () => {
    expect(ler('tem hospedagem?', 'aguardando_interesse_mini').intencao).toBe('fora_do_script');
  });

  it('evento corporativo continua indo para a Raquel', () => {
    expect(ler('é para uma confraternização da empresa, tem hospedagem?', 'novo').intencao).toBe('fora_do_script');
  });
});

describe('decidir: responde a dúvida e segue o fluxo', () => {
  it('primeiro contato: abertura, vídeo, resposta, e só então a pergunta de orçamento', () => {
    const r = decidir(conversaEm('novo'), ler('Oi, queria um orçamento. Vocês têm hospedagem?', 'novo', 'seguir_fluxo'), ctx);
    expect(r.saidas.map((s) => s.tipo)).toEqual(['texto', 'video', 'texto', 'texto']);
    expect(textos(r)[2]).toBe(MSG.faqHospedagem);
    expect(textos(r)[3]).toBe(MSG.perguntaQualificadora);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('o print da Raquel: quer visitar, depois pergunta "tabela de valores? hospedagens?"', () => {
    const r = decidir(
      conversaEm('aguardando_pref_visita'),
      ler('Nossa eu amei! E a tabela de valores? Vocês tem hospedagens?', 'aguardando_pref_visita'),
      ctx,
    );
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
    expect(textos(r)[0]).toBe(MSG.faqHospedagem);
    // Valores: a mensagem de data para orçamento.
    expect(textos(r)[1]).toMatch(/data e o ano do evento/);
  });

  it('na visita, só hospedagem: responde e continua esperando o dia da visita', () => {
    const r = decidir(conversaEm('aguardando_pref_visita'), ler('vocês têm hospedagem?', 'aguardando_pref_visita'), ctx);
    expect(textos(r)).toEqual([MSG.faqHospedagem]);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
  });

  it('na visita, dando o dia junto da dúvida: o fluxo da visita segue', () => {
    const entrada = ajustarEntrada('pode ser sexta às 10h, tem hospedagem?', 'aguardando_pref_visita', {
      slots: {},
      intencao: 'seguir_fluxo',
      visita: { diaSemana: 'sexta' },
    });
    const r = decidir(conversaEm('aguardando_pref_visita'), entrada, ctx);
    expect(textos(r)[0]).toBe(MSG.faqHospedagem);
    expect(r.conversa.estado).toBe('handoff');
  });

  it('pacotes fechados no meio da qualificação: responde e repete o que falta', () => {
    const r = decidir(
      conversaEm('aguardando_qualificacao', { convidados: 150 }),
      ler('vocês trabalham com pacotes fechados?', 'aguardando_qualificacao'),
      ctx,
    );
    expect(textos(r)[0]).toBe(MSG.faqPacotes);
    expect(textos(r)).toHaveLength(2);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });

  it('depois da proposta (convite já enviado): só a resposta, sem handoff e sem puxar fluxo', () => {
    const r = decidir(
      { ...conversaEm('proposta_enviada'), conviteEnviadoEm: AGORA },
      ler('e tem hospedagem?', 'proposta_enviada'),
      ctx,
    );
    expect(textos(r)).toEqual([MSG.faqHospedagem]);
    expect(r.conversa.estado).toBe('proposta_enviada');
  });

  it('depois da proposta, antes dos 5 minutos (convite pendente): a resposta e, em seguida, o convite', () => {
    const r = decidir(conversaEm('proposta_enviada'), ler('e tem hospedagem?', 'proposta_enviada'), ctx);
    expect(textos(r)).toEqual([MSG.faqHospedagem, MSG.conviteVisitaPosProposta]);
    expect(r.conversa.conviteEnviadoEm).toBe(AGORA);
  });

  it('as duas dúvidas juntas: hospedagem e pacotes, nessa ordem', () => {
    const r = decidir(
      { ...conversaEm('proposta_enviada'), conviteEnviadoEm: AGORA },
      ler('tem hospedagem? e vocês trabalham com pacotes fechados?', 'proposta_enviada'),
      ctx,
    );
    expect(textos(r)).toEqual([MSG.faqHospedagem, MSG.faqPacotes]);
  });

  it('na oferta do mini: PDF do mini e Raquel, sem o texto da hospedagem', () => {
    const r = decidir(conversaEm('aguardando_interesse_mini'), ler('tem hospedagem?', 'aguardando_interesse_mini'), ctx);
    expect(textos(r)).not.toContain(MSG.faqHospedagem);
    expect(r.saidas.some((s) => s.tipo === 'pdf')).toBe(true);
    expect(r.conversa.estado).toBe('handoff');
  });

  it('só pergunta de valor em conversa comercial: nada muda (pede os dados)', () => {
    const r = decidir(conversaEm('aguardando_qualificacao'), ler('qual a tabela de valores?', 'aguardando_qualificacao'), ctx);
    expect(textos(r)).not.toContain(MSG.faqHospedagem);
    expect(r.conversa.estado).toBe('aguardando_qualificacao');
  });
});

describe('texto do 2029 (Raquel, 16/10)', () => {
  it('termina em "Segue:" e usa "ter uma ideia dos valores praticados"', () => {
    expect(MSG.agenda2029).toMatch(/para você ter uma ideia dos valores praticados/);
    expect(MSG.agenda2029).toMatch(/condições para sua data\. Segue:$/);
  });
});
