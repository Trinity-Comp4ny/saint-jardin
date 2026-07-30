import { describe, expect, it } from 'vitest';
import {
  descreverData,
  descreverSlot,
  filtrarPreferencia,
  resolverDataTecnica,
  slotsCandidatos,
  validarVisitaTecnica,
} from '../src/domain/visita';

// Quarta-feira, 12h. Janelas: seg-sex 9,10,11,14,15,16; sábado 9,10,11.
const QUARTA_MEIODIA = '2026-08-05T12:00:00.000';

describe('slotsCandidatos', () => {
  it('gera só horários futuros dentro das janelas', () => {
    const slots = slotsCandidatos(QUARTA_MEIODIA, 3); // qua, qui, sex
    // quarta: só 14,15,16 (9-11 já passaram do meio-dia)
    expect(slots).toContain('2026-08-05T14:00');
    expect(slots).not.toContain('2026-08-05T09:00');
    // quinta e sexta completas
    expect(slots).toContain('2026-08-06T09:00');
    expect(slots).toContain('2026-08-07T16:00');
  });

  it('pula domingo (fora das janelas)', () => {
    // 2026-08-09 é domingo
    const slots = slotsCandidatos('2026-08-08T08:00:00.000', 2); // sáb, dom
    expect(slots.some((s) => s.startsWith('2026-08-09'))).toBe(false);
    // sábado só de manhã
    expect(slots).toContain('2026-08-08T09:00');
    expect(slots).not.toContain('2026-08-08T14:00');
  });
});

describe('filtrarPreferencia', () => {
  const slots = slotsCandidatos(QUARTA_MEIODIA, 7);

  it('filtra por dia da semana', () => {
    const so_quinta = filtrarPreferencia(slots, { diaSemana: 'quinta' });
    expect(so_quinta.every((s) => new Date(s).getDay() === 4)).toBe(true);
    expect(so_quinta.length).toBeGreaterThan(0);
  });

  it('filtra por período (tarde = a partir das 12h)', () => {
    const tarde = filtrarPreferencia(slots, { periodo: 'tarde' });
    expect(tarde.every((s) => new Date(s).getHours() >= 12)).toBe(true);
  });

  it('indiferente não filtra nada', () => {
    expect(filtrarPreferencia(slots, { indiferente: true })).toEqual(slots);
  });
});

describe('descreverSlot', () => {
  it('formata dia da semana, data e hora', () => {
    expect(descreverSlot('2026-08-06T14:00')).toBe('quinta-feira (06/08) às 14h');
  });
});

describe('visita técnica', () => {
  const HOJE = '2026-07-21T12:00:00.000Z';

  describe('validarVisitaTecnica', () => {
    it('aceita terça a sexta com ≥30 dias', () => {
      expect(validarVisitaTecnica('2026-09-16', HOJE)).toEqual({ ok: true }); // quarta, 57d
      expect(validarVisitaTecnica('2026-08-25', HOJE)).toEqual({ ok: true }); // terça, 35d
    });

    it('recusa fim de semana', () => {
      expect(validarVisitaTecnica('2026-09-19', HOJE)).toEqual({ ok: false, motivo: 'fim_de_semana' });
    });

    it('recusa antecedência menor que 30 dias', () => {
      expect(validarVisitaTecnica('2026-08-05', HOJE)).toEqual({ ok: false, motivo: 'antecedencia' });
    });
  });

  describe('resolverDataTecnica', () => {
    it('usa a data completa quando informada', () => {
      expect(resolverDataTecnica({ data: '2026-09-16' }, HOJE)).toBe('2026-09-16');
    });

    it('combina dia/mês com o ano informado', () => {
      expect(resolverDataTecnica({ mesDia: '09-16', ano: 2028 }, HOJE)).toBe('2028-09-16');
    });

    it('dia/mês sem ano: usa o ano corrente se já dá 30 dias', () => {
      expect(resolverDataTecnica({ mesDia: '09-16' }, HOJE)).toBe('2026-09-16');
    });

    it('dia/mês sem ano e já passou/muito perto: vai para o próximo ano', () => {
      // 21/07 tem só 0 dias de antecedência a partir de 21/07 -> próximo ano
      expect(resolverDataTecnica({ mesDia: '07-21' }, HOJE)).toBe('2027-07-21');
    });

    it('sem data nenhuma retorna undefined', () => {
      expect(resolverDataTecnica({}, HOJE)).toBeUndefined();
    });
  });

  describe('descreverData', () => {
    it('formata dia da semana, data e ano', () => {
      expect(descreverData('2026-09-16')).toBe('quarta-feira (16/09/2026)');
    });
  });
});
