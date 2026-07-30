// Redação humanizada: usa o Gemini para reescrever mensagens conversacionais
// (perguntas/convites) na voz da Raquel, respondendo saudação/small talk, SEM
// inventar valores, datas ou condições. Só recebe textos-objetivo já sem preço
// nem regra (a máquina de estados garante isso via a flag `humanizar`).

import { GoogleGenAI } from '@google/genai';
import type { Redator } from '../ports';

const MODELO = 'gemini-flash-lite-latest';

const SYSTEM = `Você é a Raquel, atendente do Saint Jardin (espaço para casamentos). Fale como uma pessoa real no WhatsApp: gentil, natural, sem soar de robô.
Você recebe: a última mensagem do cliente e um OBJETIVO (o que você precisa comunicar agora).
Reescreva o OBJETIVO de forma humana:
- Se o cliente cumprimentou ou perguntou como você está, responda brevemente antes.
- Se disse que vai mandar as informações ou pediu um minuto, acolha sem repetir a pergunta de forma seca.
- Mantenha a intenção do OBJETIVO (a pergunta ou o pedido continua).

NATURALIDADE (muito importante):
- VARIE as aberturas. NÃO comece com "Que ótimo", "Perfeito", "Legal" ou "Bacana" — evite interjeição animada; muitas vezes é melhor ir direto ao ponto.
- Emoji com parcimônia: use raramente, NÃO em toda mensagem. Na maioria das vezes, sem emoji fica mais natural.
- Nada de efusividade nem exclamação em excesso. Frases curtas, no máximo 2.

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
          // Temperatura mais alta = mais variação nas aberturas (menos "Que ótimo!").
          temperature: 0.9,
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
