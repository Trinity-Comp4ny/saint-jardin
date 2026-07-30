import { describe, expect, it } from 'vitest';
import { slotOcupado } from '../src/adapters/GoogleAgendaVisita';

// Slot dura 60min. Busy vem em UTC (Z); slot é local BR (-03:00).
// 2026-08-06T14:00 local = 17:00Z.
describe('slotOcupado', () => {
  it('livre quando não há nada no horário', () => {
    expect(slotOcupado('2026-08-06T14:00', 60, [])).toBe(false);
  });

  it('ocupado quando um evento cobre o slot', () => {
    const busy = [{ start: '2026-08-06T17:00:00Z', end: '2026-08-06T18:00:00Z' }];
    expect(slotOcupado('2026-08-06T14:00', 60, busy)).toBe(true);
  });

  it('ocupado quando o evento sobrepõe parcialmente', () => {
    // evento 14:30-15:30 local = 17:30-18:30Z, pega o fim do slot 14:00-15:00
    const busy = [{ start: '2026-08-06T17:30:00Z', end: '2026-08-06T18:30:00Z' }];
    expect(slotOcupado('2026-08-06T14:00', 60, busy)).toBe(true);
  });

  it('livre quando o evento é adjacente mas não sobrepõe', () => {
    // evento 15:00-16:00 local = 18:00-19:00Z, começa quando o slot termina
    const busy = [{ start: '2026-08-06T18:00:00Z', end: '2026-08-06T19:00:00Z' }];
    expect(slotOcupado('2026-08-06T14:00', 60, busy)).toBe(false);
  });

  it('livre quando o evento é em outro dia', () => {
    const busy = [{ start: '2026-08-07T17:00:00Z', end: '2026-08-07T18:00:00Z' }];
    expect(slotOcupado('2026-08-06T14:00', 60, busy)).toBe(false);
  });
});
