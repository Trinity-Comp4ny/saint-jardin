// Redação humanizada: usa o Gemini para reescrever mensagens conversacionais
// (perguntas/convites) na voz da Raquel, respondendo saudação/small talk, SEM
// inventar valores, datas ou condições. Só recebe textos-objetivo já sem preço
// nem regra (a máquina de estados garante isso via a flag `humanizar`).

import { GoogleGenAI } from '@google/genai';
import type { Redator } from '../ports';

const MODELO = 'gemini-flash-lite-latest';

const SYSTEM = `Você é a Raquel, atendente do Saint Jardin (espaço para casamentos). Tom caloroso, gentil e natural, como no WhatsApp.
Você recebe: a última mensagem do cliente e um OBJETIVO (o que você precisa comunicar agora).
Reescreva o OBJETIVO de forma humana e acolhedora:
- Se o cliente cumprimentou ou perguntou como você está ("tudo bem?"), responda brevemente e de forma simpática antes (ex.: "Tudo bem, e você? ☺️").
- Se o cliente disse que vai mandar as informações ou pediu um minuto, acolha ("Claro, fico no aguardo!") sem repetir a pergunta de forma seca.
- Mantenha a intenção do OBJETIVO (a pergunta ou o pedido continua).
- Seja concisa: no máximo 2 frases curtas. Pode usar 1 emoji suave.

REGRAS INVIOLÁVEIS:
- NUNCA cite valores, preços, números de convidados, datas disponíveis, prazos ou condições. Nada de inventar informação.
- NUNCA prometa nada além do que está no OBJETIVO.
- Responda em português. Devolva só o texto final da mensagem, sem aspas, sem explicações.`;

export class GeminiRedator implements Redator {
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente para GeminiRedator');
    this.client = new GoogleGenAI({ apiKey });
  }

  async humanizar(entrada: { objetivo: string; mensagemCliente: string }): Promise<string> {
    try {
      const resp = await this.client.models.generateContent({
        model: MODELO,
        contents:
          `Mensagem do cliente: "${entrada.mensagemCliente}"\n` +
          `OBJETIVO (o que comunicar agora): "${entrada.objetivo}"`,
        config: {
          systemInstruction: SYSTEM,
          temperature: 0.6,
          maxOutputTokens: 200,
        },
      });
      const t = (resp.text ?? '').trim().replace(/^["']|["']$/g, '');
      // Fallback: se vier vazio, usa o texto-objetivo literal.
      return t || entrada.objetivo;
    } catch {
      // A redação é best-effort: qualquer falha cai no texto fixo original.
      return entrada.objetivo;
    }
  }
}
