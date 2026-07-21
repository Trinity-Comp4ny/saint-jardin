// Transcrição de áudio das noivas: baixa a mídia da Meta e transcreve no Groq
// (whisper-large-v3, PT-BR). Barato e rápido.

export interface Transcriber {
  transcrever(mediaId: string): Promise<string>;
}

export interface GroqConfig {
  groqApiKey: string;
  whatsappToken: string;
  versaoGraph?: string;
  modelo?: string;
}

export class GroqTranscriber implements Transcriber {
  constructor(private readonly cfg: GroqConfig) {}

  async transcrever(mediaId: string): Promise<string> {
    const audio = await this.baixarMidia(mediaId);
    const form = new FormData();
    form.append('file', audio, 'audio.ogg');
    form.append('model', this.cfg.modelo ?? 'whisper-large-v3');
    form.append('language', 'pt');

    const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.groqApiKey}` },
      body: form,
    });
    if (!resp.ok) {
      throw new Error(`Groq ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json()) as { text?: string };
    return data.text?.trim() ?? '';
  }

  /** Resolve a URL da mídia na Meta e baixa o binário (ambos exigem token). */
  private async baixarMidia(mediaId: string): Promise<Blob> {
    const versao = this.cfg.versaoGraph ?? 'v21.0';
    const metaResp = await fetch(`https://graph.facebook.com/${versao}/${mediaId}`, {
      headers: { Authorization: `Bearer ${this.cfg.whatsappToken}` },
    });
    if (!metaResp.ok) {
      throw new Error(`Meta media ${metaResp.status}: ${await metaResp.text()}`);
    }
    const { url } = (await metaResp.json()) as { url?: string };
    if (!url) throw new Error('URL de mídia ausente na resposta da Meta');

    const bin = await fetch(url, {
      headers: { Authorization: `Bearer ${this.cfg.whatsappToken}` },
    });
    if (!bin.ok) throw new Error(`Download de mídia ${bin.status}`);
    return bin.blob();
  }
}
