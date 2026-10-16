// Cliente único do Gemini (NLU, Redator e transcrição). O retry do SDK é opt-in: sem
// `retryOptions` ele faz uma chamada só, e um 503 passageiro virava handoff mudo.

import { GoogleGenAI } from '@google/genai';

/** Total de chamadas por pedido, a primeira incluída. O SDK espera ~1 s e ~2 s entre elas. */
export const GEMINI_TENTATIVAS = 3;

/**
 * Tenta de novo em 408, 429, 500, 502, 503, 504 e em timeout. `timeoutMs` vale por chamada: o pior
 * caso de um pedido é `timeoutMs * GEMINI_TENTATIVAS + 3 s`, e o turno todo tem 60 s (maxDuration).
 * Em 16/10 um turno levou 40 s com o NLU pendurado duas vezes em 15 s; a Raquel esperou, por isso 10 s.
 */
export function criarClienteGemini(apiKey: string, timeoutMs: number): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: timeoutMs, retryOptions: { attempts: GEMINI_TENTATIVAS } },
  });
}
