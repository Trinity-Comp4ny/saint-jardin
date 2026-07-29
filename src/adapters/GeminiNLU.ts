// NLU de produção: usa Gemini só para LER a mensagem do lead
// (extrair dados e classificar intenção). A decisão do fluxo é da máquina de
// estados, não do modelo. Barato e com saída estruturada (responseSchema).

import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import type { NLU } from '../ports';
import type { Conversa, EntradaNLU } from '../domain/types';

// Alias "-latest": aponta sempre para o flash estável mais recente, evitando
// que o modelo seja descontinuado (versões pinadas antigas sofrem EOL).
const MODELO = 'gemini-flash-latest';

const DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const;
const INTENCOES = [
  'seguir_fluxo',
  'agendar_visita',
  'negociar',
  'fora_do_script',
  'cliente_fechado',
] as const;

// Estrutura que o Gemini é OBRIGADO a devolver (structured output). Campos
// ausentes vêm como null; limpamos antes de validar com o Zod.
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    slots: {
      type: Type.OBJECT,
      properties: {
        data: { type: Type.STRING, nullable: true },
        ano: { type: Type.INTEGER, nullable: true },
        diaSemana: { type: Type.STRING, enum: [...DIAS], nullable: true },
        preferenciaDia: {
          type: Type.STRING,
          enum: ['fim_de_semana', 'dia_de_semana'],
          nullable: true,
        },
        convidados: { type: Type.INTEGER, nullable: true },
      },
    },
    intencao: { type: Type.STRING, enum: [...INTENCOES] },
    afirmativo: { type: Type.BOOLEAN, nullable: true },
    nomeDetectado: { type: Type.STRING, nullable: true },
    dataEventoDetectada: { type: Type.STRING, nullable: true },
  },
  required: ['intencao'],
} as const;

// Coerção tolerante: o LLM às vezes manda número como string ("2027").
const numeroOpcional = z.preprocess(
  (v) => (v === null || v === undefined || v === '' ? undefined : Number(v)),
  z.number().optional(),
);

const schema = z.object({
  slots: z
    .object({
      data: z.string().optional(),
      ano: z.preprocess(
        (v) => (v === null || v === undefined || v === '' ? undefined : Number(v)),
        z.union([z.literal(2027), z.literal(2028)]).optional(),
      ),
      diaSemana: z.enum(DIAS).optional(),
      preferenciaDia: z.enum(['fim_de_semana', 'dia_de_semana']).optional(),
      convidados: numeroOpcional,
    })
    .default({}),
  intencao: z.enum(INTENCOES).default('seguir_fluxo'),
  afirmativo: z.boolean().optional(),
  nomeDetectado: z.string().optional(),
  dataEventoDetectada: z.string().optional(),
});

const SYSTEM = `Você é um extrator de informações de mensagens de noivas para o Saint Jardin (espaço de casamentos).
Sua ÚNICA função é LER a mensagem e devolver os dados. Você NUNCA responde à noiva.

Extraia (deixe null o que a mensagem não disser):
- slots.data: data do evento em ISO (yyyy-mm-dd) apenas se houver data completa com dia, mês e ano.
- slots.ano: 2027 ou 2028, se citado (inclusive dentro de uma data).
- slots.diaSemana: o dia da semana exato, se citado (ex.: "sábado" -> sabado, sem acento).
- slots.preferenciaDia: "fim_de_semana" (sábado/domingo) ou "dia_de_semana" (segunda a sexta),
  quando a pessoa fala de forma genérica sem citar o dia exato.
- slots.convidados: número estimado de convidados (ex.: "150 pessoas" -> 150).
- intencao:
  - "cliente_fechado": dá a entender que JÁ contratou/fechou o casamento.
  - "agendar_visita": quer marcar/agendar uma visita.
  - "negociar": quer desconto, parcelamento ou mudar condição de valor.
  - "fora_do_script": pergunta que foge do primeiro atendimento padrão.
  - "seguir_fluxo": caso geral (informa dados, cumprimenta, pede orçamento).
- afirmativo: true se for uma resposta positiva (sim, quero, pode mandar).
- nomeDetectado / dataEventoDetectada: se a pessoa se identificar como cliente já fechado.`;

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
        responseSchema,
        temperature: 0,
        // Flash recentes têm "thinking" ligado e consomem tokens raciocinando;
        // damos folga para não truncar o JSON (finishReason MAX_TOKENS).
        maxOutputTokens: 2048,
      },
    });

    const json = limparNulos(extrairJson(resp.text ?? '{}'));
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

/** Remove chaves com valor null (o Gemini devolve null para campos ausentes). */
function limparNulos(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(limparNulos);
  if (valor && typeof valor === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor)) {
      if (v === null) continue;
      saida[k] = limparNulos(v);
    }
    return saida;
  }
  return valor;
}
