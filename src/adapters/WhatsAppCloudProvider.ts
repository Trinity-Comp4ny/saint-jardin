// Envio de mensagens pela WhatsApp Cloud API (Graph API). Texto e documento (PDF).

import type { MessagingProvider } from '../ports';
import type { MensagemSaida, TipoPdf } from '../domain/types';
import { PDF_CATALOGO } from '../domain/pdfs';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WhatsAppConfig {
  phoneNumberId: string;
  token: string;
  /** Resolve a URL pública/assinada do PDF (ex.: Supabase Storage signed URL). */
  resolverPdfUrl: (tipo: TipoPdf) => Promise<string>;
  versaoGraph?: string;
  /** Pausa entre mensagens de texto (simula digitação; não a última). */
  delayEntreMs?: number;
  /** Pausa após um documento: a Meta entrega PDF mais devagar que texto, então
   *  esperamos mais para o PDF chegar antes da mensagem seguinte. */
  delayDepoisPdfMs?: number;
  /** Pausa ANTES da primeira mensagem, para o "digitando…" ficar visível um
   *  instante antes da resposta chegar. 0/ausente = sem pausa. */
  delayInicioMs?: number;
}

export class WhatsAppCloudProvider implements MessagingProvider {
  constructor(private readonly cfg: WhatsAppConfig) {}

  async enviar(telefone: string, saidas: MensagemSaida[]): Promise<void> {
    const entre = this.cfg.delayEntreMs ?? 1500;
    const depoisPdf = this.cfg.delayDepoisPdfMs ?? 4000;

    // Deixa o "digitando…" aparecer um instante antes da primeira mensagem.
    if (this.cfg.delayInicioMs) await sleep(this.cfg.delayInicioMs);

    // Sequencial para preservar a ordem das mensagens na conversa. O envio já é
    // ordenado, mas documentos são entregues mais devagar que texto: a pausa
    // maior após um PDF garante que ele apareça antes da próxima mensagem.
    for (let i = 0; i < saidas.length; i++) {
      const s = saidas[i];
      if (!s) continue;
      let ehPdf = false;
      if (s.tipo === 'pdf' && s.pdf) {
        await this.enviarDocumento(telefone, s.pdf);
        ehPdf = true;
      } else if (s.texto) {
        await this.enviarTexto(telefone, s.texto);
      } else {
        continue;
      }
      if (i < saidas.length - 1) await sleep(ehPdf ? depoisPdf : entre);
    }
  }

  async marcarLido(messageId: string): Promise<void> {
    // Best-effort: um recibo de leitura que falha não pode derrubar o turno.
    try {
      await this.post({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      });
    } catch {
      // Sem retry: se o recibo não foi, no pior caso a conversa fica não lida.
    }
  }

  async mostrarDigitando(messageId: string): Promise<void> {
    // O typing indicator da Cloud API vai junto do recibo de leitura (status:read)
    // e dura ~25s ou até a próxima mensagem. Best-effort, como o marcarLido.
    try {
      await this.post({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      });
    } catch {
      // Falhou: no pior caso não aparece o "digitando" e a mensagem segue normal.
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
