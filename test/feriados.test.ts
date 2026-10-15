import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ehFeriadoFixoOuVespera, ehFeriadoOuVespera, feriadosDoAno } from '../src/domain/feriados';

type Fixture = Record<string, { date: string; name: string }[]>;
const oraculo: Fixture = JSON.parse(readFileSync(new URL('./fixtures/feriados-brasilapi.json', import.meta.url), 'utf8'));

describe('feriadosDoAno bate com a BrasilAPI (2026 a 2035)', () => {
  for (const [ano, lista] of Object.entries(oraculo)) {
    it(`${ano}: mesmas datas`, () => {
      // Conjunto: em 2030 a Páscoa e o Tiradentes caem no mesmo dia (21/04) e a API lista a data 2 vezes.
      const esperado = [...new Set(lista.map((f) => f.date))].sort();
      expect([...feriadosDoAno(Number(ano))].sort()).toEqual(esperado);
    });
  }
});

describe('ehFeriadoOuVespera', () => {
  it('feriado fixo de semana: 7/9/2027 (terça)', () => {
    expect(ehFeriadoOuVespera('2027-09-07')).toBe(true);
  });

  it('véspera de feriado: 6/9/2027 (segunda)', () => {
    expect(ehFeriadoOuVespera('2027-09-06')).toBe(true);
  });

  it('feriados móveis de 2027: Carnaval (8 e 9/2), Sexta Santa (26/3), Corpus Christi (27/5)', () => {
    for (const d of ['2027-02-08', '2027-02-09', '2027-03-26', '2027-05-27']) expect(ehFeriadoOuVespera(d)).toBe(true);
  });

  it('véspera de feriado móvel: quarta 26/5/2027 (véspera de Corpus Christi, quinta)', () => {
    expect(ehFeriadoOuVespera('2027-05-26')).toBe(true);
  });

  it('dia comum não é feriado nem véspera', () => {
    expect(ehFeriadoOuVespera('2027-09-08')).toBe(false); // dia seguinte ao feriado
    expect(ehFeriadoOuVespera('2028-03-15')).toBe(false);
  });

  it('31/12 é véspera de 1º de janeiro (vira o ano)', () => {
    expect(ehFeriadoOuVespera('2027-12-31')).toBe(true);
  });

  it('2028 (bissexto): Natal e véspera, e um dia de semana comum', () => {
    expect(ehFeriadoOuVespera('2028-12-25')).toBe(true);
    expect(ehFeriadoOuVespera('2028-12-24')).toBe(true);
    expect(ehFeriadoOuVespera('2028-03-14')).toBe(false);
  });

  it('datas inválidas não explodem', () => {
    expect(ehFeriadoOuVespera('lixo')).toBe(false);
  });
});

describe('ehFeriadoFixoOuVespera (sem ano)', () => {
  it('feriado e véspera de data fixa', () => {
    expect(ehFeriadoFixoOuVespera('09-07')).toBe(true);
    expect(ehFeriadoFixoOuVespera('09-06')).toBe(true);
    expect(ehFeriadoFixoOuVespera('12-31')).toBe(true);
  });

  it('dia comum e feriados móveis (dependem do ano) não entram', () => {
    expect(ehFeriadoFixoOuVespera('03-15')).toBe(false);
    expect(ehFeriadoFixoOuVespera('02-08')).toBe(false);
  });
});
