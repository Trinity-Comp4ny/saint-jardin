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
Reescreva o OBJETIVO de forma humana, usando o histórico para soar contextual (uma pessoa que lembra do que já foi dito):
- Só responda a saudação ou "tudo bem?" SE a mensagem do cliente REALMENTE tiver isso. Aí sim, responda com naturalidade e reciprocidade ("Oi! Tudo ótimo, e com você?") ANTES de seguir ao OBJETIVO. Se a mensagem for apenas uma informação (um dia, um número, uma data, uma resposta curta como "sim"), NÃO invente saudação nem "tudo bem por aqui" — vá direto ao OBJETIVO, de forma gentil e breve.
- Não repita uma saudação ou uma pergunta que, pelo histórico, você já fez há pouco: varie ou vá direto ao ponto.
- Se o cliente disse que vai mandar as informações ou pediu um minuto, acolha sem repetir a pergunta de forma seca.
- Se um NOME do cliente for informado, use-o com MUITA parcimônia e SEMPRE no INÍCIO da mensagem, como vocativo (ex.: "Marina, ..." ou "Prazer, Marina!"). NUNCA jogue o nome no meio de uma frase (nada de "e o número de convidados, Marina, você já tem?"). Na maioria das mensagens é melhor NÃO usar o nome; reserve para a saudação inicial e, no máximo, uma vez de vez em quando.
- Mantenha a intenção do OBJETIVO (a pergunta ou o pedido continua exatamente com o mesmo sentido).

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
          // Temperatura mais alta = mais variação nas aberturas (menos "Que ótimo!").
          temperature: 0.9,
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
