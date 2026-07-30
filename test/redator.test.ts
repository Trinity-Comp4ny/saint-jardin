import { describe, expect, it } from 'vitest';
import { capitalizar } from '../src/adapters/GeminiRedator';

describe('capitalizar', () => {
  it('deixa a primeira letra maiúscula', () => {
    expect(capitalizar('boa tarde! Tudo bem?')).toBe('Boa tarde! Tudo bem?');
  });

  it('mantém quando já está capitalizado', () => {
    expect(capitalizar('Oi, tudo bem?')).toBe('Oi, tudo bem?');
  });

  it('pula emoji/pontuação inicial e capitaliza a primeira letra', () => {
    expect(capitalizar('☺️ oi')).toBe('☺️ Oi');
  });

  it('texto sem letras fica intacto', () => {
    expect(capitalizar('...')).toBe('...');
  });
});
