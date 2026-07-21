// Envio de mensagens pela WhatsApp Cloud API (Graph API). Texto e documento (PDF).

import type { MessagingProvider } from '../ports';
import type { MensagemSaida, TipoPdf } from '../domain/types';
import { PDF_CATALOGO } from '../domain/pdfs';

export interface WhatsAppConfig {
  phoneNumberId: string;
  token: string;
  /** Resolve a URL pública/assinada do PDF (ex.: Supabase Storage signed URL). */
  resolverPdfUrl: (tipo: TipoPdf) => Promise<string>;
  versaoGraph?: string;
}

export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(private readonly cfg: WhatsAppConfig) {}

  async enviar(telefone: string, saidas: MensagemSaida[]): Promise<void> {
    // Sequencial para preservar a ordem das mensagens na conversa.
    for (const s of saidas) {
      if (s.tipo === 'pdf' && s.pdf) {
        await this.enviarDocumento(telefone, s.pdf);
      } else if (s.texto) {
        await this.enviarTexto(telefone, s.texto);
      }
    }
  }

  private async enviarTexto(telefone: string, texto: string): Promise<void> {
    await this.post({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'text',
      text: { body: texto },
    });
  }

  private async enviarDocumento(telefone: string, tipo: TipoPdf): Promise<void> {
    const link = await this.cfg.resolverPdfUrl(tipo);
    await this.post({
      messaging_product: 'whatsapp',
      to: telefone,
      type: 'document',
      document: { link, filename: PDF_CATALOGO[tipo].arquivo },
    });
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    const versao = this.cfg.versaoGraph ?? 'v21.0';
    const url = `https://graph.facebook.com/${versao}/${this.cfg.phoneNumberId}/messages`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detalhe = await resp.text();
      throw new Error(`Cloud API ${resp.status}: ${detalhe}`);
    }
  }
}
