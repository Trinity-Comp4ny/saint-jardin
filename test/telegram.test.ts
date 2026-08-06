import { describe, expect, it } from 'vitest';
import { mensagemHandoff } from '../src/adapters/TelegramNotifier';
import type { Conversa } from '../src/domain/types';

function conversa(slots: Conversa['slots']): Conversa {
  return {
    telefone: '5511988887777',
    estado: 'handoff',
    slots,
    criadoEm: '2026-08-06T12:00:00.000Z',
    atualizadoEm: '2026-08-06T12:00:00.000Z',
  };
}

describe('alerta de handoff no Telegram', () => {
  it('inclui o nome e o resumo do evento para a Raquel', () => {
    const texto = mensagemHandoff(
      conversa({ nome: 'Ester', data: '2028-10-15', diaSemana: 'sabado', convidados: 200 }),
      'visita da noiva (domingo de manhã)',
    );
    expect(texto).toMatch(/Noiva: Ester/);
    expect(texto).toMatch(/Evento: 15\/10\/2028 · sábado · 200 convidados/);
    expect(texto).toMatch(/Motivo: visita da noiva/);
    expect(texto).toMatch(/5511988887777/);
  });

  it('omite as linhas de nome/evento quando não há dados (ex.: fornecedor)', () => {
    const texto = mensagemHandoff(conversa({}), 'fornecedor/parceria (não é noiva)');
    expect(texto).not.toMatch(/Noiva:/);
    expect(texto).not.toMatch(/Evento:/);
    expect(texto).toMatch(/Motivo: fornecedor/);
  });
});
