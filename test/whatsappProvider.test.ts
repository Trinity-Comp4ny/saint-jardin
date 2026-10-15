import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppCloudProvider } from '../src/adapters/WhatsAppCloudProvider';

afterEach(() => vi.unstubAllGlobals());

function provider() {
  return new WhatsAppCloudProvider({
    phoneNumberId: '123',
    token: 'tok',
    resolverPdfUrl: async (tipo) => `https://files/${tipo}.pdf`,
    resolverVideoUrl: async (tipo) => `https://files/${tipo}.mp4`,
    delayEntreMs: 0,
    delayDepoisPdfMs: 0,
    delayDepoisVideoMs: 0,
  });
}

describe('WhatsAppCloudProvider', () => {
  it('envia abertura, vídeo e qualificadora nessa ordem, com o vídeo como mensagem de vídeo', async () => {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        corpos.push(JSON.parse(init.body));
        return { ok: true, text: async () => '' };
      }),
    );

    await provider().enviar('5511', [
      { tipo: 'texto', texto: 'abertura' },
      { tipo: 'video', video: 'apresentacao' },
      { tipo: 'texto', texto: 'qualificadora' },
    ]);

    expect(corpos.map((c) => c.type)).toEqual(['text', 'video', 'text']);
    expect(corpos[1]?.video).toEqual({ link: 'https://files/apresentacao.mp4' });
    expect(corpos[1]?.to).toBe('5511');
  });

  it('envia o PDF como documento com o nome do arquivo do catálogo', async () => {
    const corpos: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        corpos.push(JSON.parse(init.body));
        return { ok: true, text: async () => '' };
      }),
    );

    await provider().enviar('5511', [{ tipo: 'pdf', pdf: 'proposta_mini' }]);

    expect(corpos[0]?.type).toBe('document');
    expect(corpos[0]?.document).toEqual({
      link: 'https://files/proposta_mini.pdf',
      filename: 'Proposta Mini Wedding.pdf',
    });
  });

  it('falha em voz alta quando a Cloud API rejeita o vídeo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, text: async () => 'unsupported video' })),
    );
    await expect(
      provider().enviar('5511', [{ tipo: 'video', video: 'apresentacao' }]),
    ).rejects.toThrow(/Cloud API 400/);
  });
});
