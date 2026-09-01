// Transcrição de áudio das noivas: baixa a mídia da Meta e transcreve com o
// Gemini (mesmo provedor do NLU e do Redator, ver ADR-0007 — um único
// provedor de LLM em vez de Groq + Gemini).

import { GoogleGenAI } from '@google/genai';
import type { Transcriber } from '../ports';

export interface GeminiTranscriberConfig {
  geminiApiKey: string;
  whatsappToken: string;
  versaoGraph?: string;
  modelo?: string;
}

// Mesmo modelo do NLU/Redator: já suporta áudio como input multimodal, então
// não há motivo para um modelo (ou provedor) à parte só para transcrever.
const MODELO = 'gemini-flash-lite-latest';

const SYSTEM =
  'Você transcreve áudios em português brasileiro. Devolva SOMENTE o texto ' +
  'falado, literal: sem resumir, sem corrigir gramática, sem comentários, sem ' +
  'aspas. Pontue só o mínimo necessário para leitura. Se não houver fala ' +
  'compreensível, devolva uma string vazia.';

export class GeminiTranscriber implements Transcriber {
  private client: GoogleGenAI;

  constructor(private readonly cfg: GeminiTranscriberConfig) {
    this.client = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  }

  async transcrever(mediaId: string): Promise<string> {
    const { blob, mimeType } = await this.baixarMidia(mediaId);
    const data = Buffer.from(await blob.arrayBuffer()).toString('base64');

    const resp = await this.client.models.generateContent({
      model: this.cfg.modelo ?? MODELO,
      contents: [
        {
          role: 'user',
          parts: [{ inlineData: { mimeType, data } }, { text: 'Transcreva o áudio acima.' }],
        },
      ],
      config: { systemInstruction: SYSTEM, temperature: 0 },
    });

    return (resp.text ?? '').trim();
  }

  /** Resolve a URL da mídia na Meta e baixa o binário (ambos exigem token). */
  private async baixarMidia(mediaId: string): Promise<{ blob: Blob; mimeType: string }> {
    const versao = this.cfg.versaoGraph ?? 'v21.0';
    const metaResp = await fetch(`https://graph.facebook.com/${versao}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.cfg.whatsappToken}` },
    });
    if (!metaResp.ok) {
      throw new Error(`Meta media ${metaResp.status}: ${await metaResp.text()}`);
    }
    const { url, mime_type } = (await metaResp.json()) as { url?: string; mime_type?: string };
    if (!url) throw new Error('URL de mídia ausente na resposta da Meta');

    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${this.cfg.whatsappToken}` },
    });
    if (!bin.ok) throw new Error(`Download de mídia ${bin.status}`);
    // A Meta manda "audio/ogg; codecs=opus"; o Gemini só aceita o mime type puro.
    const mimeType = (mime_type ?? 'audio/ogg').split(';')[0]!.trim();
    return { blob: await bin.blob(), mimeType };
  }
}
