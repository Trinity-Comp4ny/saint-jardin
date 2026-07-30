// NLU de produção: usa Gemini só para LER a mensagem do lead
// (extrair dados e classificar intenção). A decisão do fluxo é da máquina de
// estados, não do modelo. Barato e com saída estruturada (responseSchema).

import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import type { NLU } from '../ports';
import type { Conversa, EntradaNLU } from '../domain/types';

// Flash-lite: mais barato e sem "thinking" por padrão (a extração é uma tarefa
// simples e determinística, não precisa raciocínio). ~10x mais barato e ~3x mais
// rápido que o flash com thinking. Alias "-latest" evita EOL de versão pinada.
const MODELO = 'gemini-flash-lite-latest';

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
        mesDia: { type: Type.STRING, nullable: true },
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
    visita: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        diaSemana: { type: Type.STRING, enum: [...DIAS], nullable: true },
        periodo: { type: Type.STRING, enum: ['manha', 'tarde'], nullable: true },
        indiferente: { type: Type.BOOLEAN, nullable: true },
      },
    },
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
      mesDia: z
        .string()
        .regex(/^\d{2}-\d{2}$/)
        .optional()
        .catch(undefined),
      ano: z.preprocess((v) => {
        if (v === null || v === undefined || v === '') return undefined;
        const n = Number(v);
        // "27"/"28" (dois dígitos) valem por 2027/2028.
        if (n === 27 || n === 2027) return 2027;
        if (n === 28 || n === 2028) return 2028;
        return n;
      }, z.union([z.literal(2027), z.literal(2028)]).optional()),
      diaSemana: z.enum(DIAS).optional(),
      preferenciaDia: z.enum(['fim_de_semana', 'dia_de_semana']).optional(),
      convidados: numeroOpcional,
    })
    .default({}),
  intencao: z.enum(INTENCOES).default('seguir_fluxo'),
  afirmativo: z.boolean().optional(),
  visita: z
    .object({
      diaSemana: z.enum(DIAS).optional(),
      periodo: z.enum(['manha', 'tarde']).optional(),
      indiferente: z.boolean().optional(),
    })
    .optional(),
  nomeDetectado: z.string().optional(),
  dataEventoDetectada: z.string().optional(),
});

const SYSTEM = `Você é um extrator de informações de mensagens de noivas para o Saint Jardin (espaço de casamentos).
Sua ÚNICA função é LER a mensagem e devolver os dados. Você NUNCA responde à noiva.

Extraia (deixe null o que a mensagem não disser):
- slots.data: data do evento em ISO (yyyy-mm-dd) apenas se houver data completa com dia, mês e ano.
- slots.mesDia: dia e mês SEM ano, no formato "MM-DD", quando a noiva disser só o dia/mês (ex.: "26 de janeiro" -> "01-26"). Deixe null se ela já deu o ano (use data) ou se não citou dia/mês.
- slots.ano: 2027 ou 2028, se citado (inclusive dentro de uma data). Aceite dois dígitos: "28" -> 2028, "27" -> 2027.
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
- visita: SÓ quando o estado for "agendando_visita" ou "aguardando_confirmacao_visita" (a noiva está escolhendo o dia da VISITA ao espaço). Preencha:
  - visita.diaSemana: dia da semana que ela prefere para a visita (ex.: "quinta" -> quinta).
  - visita.periodo: "manha" ou "tarde", se ela indicar.
  - visita.indiferente: true se ela disser que tanto faz / qualquer dia / você que escolhe.
  Nesses estados, a intenção é "seguir_fluxo" (ela está agendando), a não ser que claramente negocie valor ou saia do assunto.
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
        // O flash-lite não usa thinking, então basta caber o JSON de saída.
        maxOutputTokens: 512,
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
