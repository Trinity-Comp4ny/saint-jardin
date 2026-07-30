import { describe, expect, it } from 'vitest';
import { descreverSlot, filtrarPreferencia, slotsCandidatos } from '../src/domain/visita';

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
