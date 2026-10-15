import { describe, expect, it } from 'vitest';
import { decodificarEntidades } from '../src/domain/texto';

describe('decodificarEntidades', () => {
  it('o caso real: "s&#225;bado &#224;s 10h"', () => {
    expect(decodificarEntidades('s&#225;bado &#224;s 10h')).toBe('sábado às 10h');
  });

  it('numéricas hex e nomeadas', () => {
    expect(decodificarEntidades('s&#xE1;bado')).toBe('sábado');
    expect(decodificarEntidades('s&aacute;bado &agrave;s 10h')).toBe('sábado às 10h');
    expect(decodificarEntidades('Ana &amp; Pedro')).toBe('Ana & Pedro');
  });

  it('texto limpo e entidade desconhecida ficam intactos', () => {
    expect(decodificarEntidades('sábado às 10h')).toBe('sábado às 10h');
    expect(decodificarEntidades('a &foo; b')).toBe('a &foo; b');
    expect(decodificarEntidades('&#99999999999;')).toBe('&#99999999999;');
  });
});
