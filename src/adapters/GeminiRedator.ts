// Redação humanizada: usa o Gemini para reescrever mensagens conversacionais
// (perguntas/convites) na voz da Raquel, respondendo saudação/small talk, SEM
// inventar valores, datas ou condições. Só recebe textos-objetivo já sem preço
// nem regra (a máquina de estados garante isso via a flag `humanizar`).

import { GoogleGenAI } from '@google/genai';
import type { MensagemLog, Redator } from '../ports';
import { formatarHistorico } from './GeminiNLU';

const MODELO = 'gemini-flash-lite-latest';

/** Garante inicial maiúscula (o modelo às vezes devolve "boa tarde"). */
export function capitalizar(t: string): string {
  const i = t.search(/\p{L}/u); // primeira letra (ignora emoji/pontuação inicial)
  if (i === -1) return t;
  return t.slice(0, i) + t.charAt(i).toUpperCase() + t.slice(i + 1);
}

const SYSTEM = `Você é a Raquel, atendente do Saint Jardin (espaço para casamentos). Fale como uma pessoa real no WhatsApp: gentil, natural, sem soar de robô.
Você recebe: o HISTÓRICO da conversa, a última mensagem do cliente e um OBJETIVO (o que você precisa comunicar agora).

Seu trabalho é dar um verniz LEVE no OBJETIVO, não reescrevê-lo do zero. Faça a MENOR mudança possível: só o suficiente para soar humano. Quanto mais perto do OBJETIVO, melhor. Não invente frases novas, não estique, não encha de floreio.

- Só responda a saudação ou "tudo bem?" SE a mensagem do cliente REALMENTE tiver isso. Aí responda curto e recíproco ("Oi! Tudo ótimo, e com você?") antes do OBJETIVO. Se a mensagem for só uma informação (um dia, um número, "sim"), vá DIRETO ao OBJETIVO, sem saudação inventada.
- NÃO comente nem opine sobre o que o cliente disse. Nada de "Domingo é ótimo!", "Que legal", "Perfeito", "Ótima escolha". Sem interjeição animada. Vá ao ponto.
- NOME: quase nunca use. Se usar, SÓ no comecinho, como vocativo separado por vírgula ("Marina, ..."). Se não couber no início, NÃO use o nome. JAMAIS coloque o nome no meio da frase.
- Se terminar pedindo confirmação, use "ok?" ou "tudo bem?" — NUNCA "tá?".
- Não repita uma saudação/pergunta que, pelo histórico, você já fez há pouco.
- Se o cliente disse que vai mandar as informações ou pediu um minuto, acolha sem repetir a pergunta de forma seca.
- Mantenha a intenção do OBJETIVO (a pergunta ou o pedido continua com o mesmo sentido).

ESTILO:
- Frases curtas, no máximo 2. Emoji raríssimo (quase sempre sem).

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

  async humanizar(entrada: {
    objetivo: string;
    mensagemCliente: string;
    jaSaudou?: boolean;
    historico?: MensagemLog[];
    nome?: string;
  }): Promise<string> {
    try {
      // Quando a saudação já foi (apresentação na mesma rajada), reforça a regra:
      // ir direto ao objetivo, sem "olá/oi/tudo bem", pra não saudar duas vezes.
      const instrucaoSaudacao = entrada.jaSaudou
        ? '\nJÁ SAUDAMOS o cliente nesta conversa agora. NÃO comece com "olá", "oi" nem "tudo bem?": vá direto ao OBJETIVO.'
        : '';
      const resp = await this.client.models.generateContent({
        model: MODELO,
        contents:
          `Conversa até aqui (mais antiga primeiro):\n${formatarHistorico(entrada.historico)}\n\n` +
          (entrada.nome ? `Nome da noiva: ${entrada.nome}\n` : '') +
          `Última mensagem do cliente: "${entrada.mensagemCliente}"\n` +
          `OBJETIVO (o que comunicar agora): "${entrada.objetivo}"${instrucaoSaudacao}`,
        config: {
          systemInstruction: SYSTEM,
          // Temperatura baixa: verniz leve e previsível, menos floreio/nome no meio.
          temperature: 0.4,
          maxOutputTokens: 200,
        },
      });
      const t = (resp.text ?? '').trim().replace(/^["']|["']$/g, '');
      // Fallback: se vier vazio, usa o texto-objetivo literal. Sempre capitaliza.
      return capitalizar(t || entrada.objetivo);
    } catch {
      // A redação é best-effort: qualquer falha cai no texto fixo original.
      return entrada.objetivo;
    }
  }
}
