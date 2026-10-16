import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiTranscriber } from '../src/adapters/GeminiTranscriber';
import { GEMINI_TENTATIVAS } from '../src/adapters/geminiClient';

// Simula a Meta (2 downloads) e o Gemini; `respostasGemini` é a sequência de status por chamada.
function simular(respostasGemini: number[]): { chamadasGemini: () => number } {
  let n = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ url: 'https://cdn.meta/audio', mime_type: 'audio/ogg; codecs=opus' }));
      }
      if (u.includes('cdn.meta')) return new Response(new Uint8Array([1, 2, 3]));
      const status = respostasGemini[n++] ?? 200;
      if (status !== 200) {
        return new Response(JSON.stringify({ error: { code: status, message: 'indisponível', status: 'UNAVAILABLE' } }), {
          status,
        });
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'cento e cinquenta convidados' }] } }] }));
    }),
  );
  return { chamadasGemini: () => n };
}

const transcriber = () => new GeminiTranscriber({ geminiApiKey: 'k', whatsappToken: 't' });

describe('Gemini: retry em erro passageiro', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('503 duas vezes e depois responde: a transcrição sai normalmente', async () => {
    const { chamadasGemini } = simular([503, 503]);
    const promessa = transcriber().transcrever('media-1');
    await vi.runAllTimersAsync();
    await expect(promessa).resolves.toBe('cento e cinquenta convidados');
    expect(chamadasGemini()).toBe(3);
  });

  it('429 (limite de uso) também tenta de novo', async () => {
    const { chamadasGemini } = simular([429]);
    const promessa = transcriber().transcrever('media-1');
    await vi.runAllTimersAsync();
    await expect(promessa).resolves.toBe('cento e cinquenta convidados');
    expect(chamadasGemini()).toBe(2);
  });

  it('fora do ar de vez: desiste depois de GEMINI_TENTATIVAS chamadas e propaga o erro', async () => {
    const { chamadasGemini } = simular([503, 503, 503, 503, 503]);
    const promessa = transcriber().transcrever('media-1');
    const resultado = promessa.then(
      () => 'resolveu',
      () => 'falhou',
    );
    await vi.runAllTimersAsync();
    expect(await resultado).toBe('falhou');
    expect(chamadasGemini()).toBe(GEMINI_TENTATIVAS);
  });

  it('erro que não é passageiro (400) não repete', async () => {
    const { chamadasGemini } = simular([400, 400, 400]);
    const promessa = transcriber().transcrever('media-1');
    const resultado = promessa.then(
      () => 'resolveu',
      () => 'falhou',
    );
    await vi.runAllTimersAsync();
    expect(await resultado).toBe('falhou');
    expect(chamadasGemini()).toBe(1);
  });
});
