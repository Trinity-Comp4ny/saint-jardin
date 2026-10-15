// Alerta de handoff pelo bot do Telegram: chega no celular da Raquel, de graça.
// A conversa em si ela atende no app do WhatsApp (coexistência).

import type { Notifier } from '../ports';
import type { Conversa } from '../domain/types';
import { resumoEvento } from '../domain/stateMachine';
import { descreverData, resumoCasamentoAtendido } from '../domain/visita';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Texto do alerta de handoff. Puro (testável): inclui o nome e o resumo do evento
 * (data/ano, dia da semana, convidados) quando já coletados, para a Raquel abrir a
 * conversa com contexto.
 */
export function mensagemHandoff(conversa: Conversa, motivo: string): string {
  const linhas = ['🔔 Uma conversa precisa de você', `Número: ${conversa.telefone}`];
  const s = conversa.slots;
  // Visita técnica: quem escreve é fornecedor, e há duas datas distintas (a da visita e a do
  // casamento que ele atende), cada uma na sua linha.
  const visitaTecnica = s.dataVisitaTecnica !== undefined || s.dataCasamento !== undefined;
  if (s.nome) linhas.push(`${visitaTecnica ? 'Fornecedor' : 'Noiva'}: ${s.nome}`);
  if (s.dataVisitaTecnica) linhas.push(`Visita técnica: ${descreverData(s.dataVisitaTecnica)}`);
  const casamento = resumoCasamentoAtendido(s);
  if (casamento) linhas.push(`Casamento atendido: ${casamento}`);
  const resumo = resumoEvento(s);
  if (resumo) linhas.push(`Evento: ${resumo}`);
  linhas.push(`Motivo: ${motivo}`);
  linhas.push('Abra o WhatsApp para responder.');
  return linhas.join('\n');
}

export class TelegramNotifier implements Notifier {
  constructor(private readonly cfg: TelegramConfig) {}

  async alertarHandoff(conversa: Conversa, motivo: string): Promise<void> {
    const texto = mensagemHandoff(conversa, motivo);
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
