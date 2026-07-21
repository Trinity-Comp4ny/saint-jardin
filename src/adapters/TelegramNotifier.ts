// Alerta de handoff pelo bot do Telegram: chega no celular da Raquel, de graça.
// A conversa em si ela atende no app do WhatsApp (coexistência).

import type { Notifier } from '../ports';
import type { Conversa } from '../domain/types';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export class TelegramNotifier implements Notifier {
  constructor(private readonly cfg: TelegramConfig) {}

  async alertarHandoff(conversa: Conversa, motivo: string): Promise<void> {
    const texto =
      `🔔 Uma conversa precisa de você\n` +
      `Número: ${conversa.telefone}\n` +
      `Motivo: ${motivo}\n` +
      `Abra o WhatsApp para responder.`;
    const resp = await fetch(
      `https://api.telegram.org/bot${this.cfg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.cfg.chatId, text: texto }),
      },
    );
    if (!resp.ok) {
      throw new Error(`Telegram ${resp.status}: ${await resp.text()}`);
    }
  }
}
