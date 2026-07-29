// NLU de produção: usa Gemini só para LER a mensagem do lead
// (extrair dados e classificar intenção). A decisão do fluxo é da máquina de
// estados, não do modelo. Barato e com saída forçada em JSON.

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import type { NLU } from '../ports';
import type { Conversa, EntradaNLU } from '../domain/types';

// Alias "-latest": aponta sempre para o flash estável mais recente, evitando
// que o modelo seja descontinuado (versões pinadas antigas sofrem EOL).
const MODELO = 'gemini-flash-latest';

const schema = z.object({
  slots: z
    .object({
      data: z.string().optional(),
      ano: z.union([z.literal(2027), z.literal(2028)]).optional(),
      diaSemana: z
        .enum(['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'])
        .optional(),
      preferenciaDia: z.enum(['fim_de_semana', 'dia_de_semana']).optional(),
      convidados: z.number().optional(),
    })
    .default({}),
  intencao: z
    .enum(['seguir_fluxo', 'agendar_visita', 'negociar', 'fora_do_script', 'cliente_fechado'])
    .default('seguir_fluxo'),
  afirmativo: z.boolean().optional(),
  nomeDetectado: z.string().optional(),
  dataEventoDetectada: z.string().optional(),
});

const SYSTEM = `Você é um extrator de informações de mensagens de noivas para o Saint Jardin (espaço de casamentos).
Sua ÚNICA função é LER a mensagem e devolver JSON. Você NUNCA responde à noiva.

Extraia:
- slots.data: data do evento em ISO (yyyy-mm-dd) apenas se houver data completa com ano.
- slots.ano: 2027 ou 2028, se citado.
- slots.diaSemana: dia da semana exato se citado (segunda..domingo).
- slots.preferenciaDia: "fim_de_semana" ou "dia_de_semana" quando a pessoa fala genérico.
- slots.convidados: número estimado de convidados.
- intencao: uma de [seguir_fluxo, agendar_visita, negociar, fora_do_script, cliente_fechado].
  - "cliente_fechado": a pessoa dá a entender que JÁ contratou/fechou o casamento.
  - "agendar_visita": quer marcar/agendar uma visita.
  - "negociar": quer desconto, parcelamento ou mudar condição de valor.
  - "fora_do_script": pergunta que foge do primeiro atendimento padrão.
  - "seguir_fluxo": caso geral (informa dados, cumprimenta, pede orçamento).
- afirmativo: true se a mensagem for uma resposta positiva (sim, quero, pode mandar).
- nomeDetectado / dataEventoDetectada: se a pessoa se identificar como cliente já fechado.

Responda SOMENTE com o objeto JSON, sem texto ao redor.`;

export class GeminiNLU implements NLU {
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente para GeminiNLU');
    this.client = new GoogleGenAI({ apiKey });
  }

  async analisar(texto: string, conversa: Conversa): Promise<EntradaNLU> {
    const resp = await this.client.models.generateContent({
      model: MODELO,
      contents:
        `Estado atual da conversa: ${conversa.estado}.\n` +
        `Dados já coletados: ${JSON.stringify(conversa.slots)}.\n` +
        `Mensagem da noiva: "${texto}"`,
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 400,
      },
    });

    const bruto = resp.text ?? '{}';
    const json = extrairJson(bruto);
    return schema.parse(json) as EntradaNLU;
  }
}

function extrairJson(s: string): unknown {
  const inicio = s.indexOf('{');
  const fim = s.lastIndexOf('}');
  if (inicio === -1 || fim === -1) return {};
  try {
    return JSON.parse(s.slice(inicio, fim + 1));
  } catch {
    return {};
  }
}
