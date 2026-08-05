// NLU de produção: usa Gemini só para LER a mensagem do lead
// (extrair dados e classificar intenção). A decisão do fluxo é da máquina de
// estados, não do modelo. Barato e com saída estruturada (responseSchema).

import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import type { MensagemLog, NLU } from '../ports';
import type { Conversa, EntradaNLU } from '../domain/types';

/** Transcrição compacta do histórico para dar contexto ao modelo (mais antigo primeiro). */
export function formatarHistorico(historico: MensagemLog[] = [], limite = 12): string {
  const recentes = historico.slice(-limite);
  if (recentes.length === 0) return '(sem histórico; é o começo da conversa)';
  return recentes
    .map((m) => {
      const quem = m.direcao === 'entrada' ? 'Noiva' : 'Raquel';
      const conteudo = m.tipo === 'pdf' ? '[enviou um PDF]' : m.conteudo;
      return `${quem}: ${conteudo}`;
    })
    .join('\n');
}

// Flash-lite: mais barato e sem "thinking" por padrão (a extração é uma tarefa
// simples e determinística, não precisa raciocínio). ~10x mais barato e ~3x mais
// rápido que o flash com thinking. Alias "-latest" evita EOL de versão pinada.
const MODELO = 'gemini-flash-lite-latest';

const DIAS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const;
const INTENCOES = [
  'seguir_fluxo',
  'agendar_visita',
  'visita_tecnica',
  'negociar',
  'fora_do_script',
  'cliente_fechado',
  'despedida',
  'fornecedor',
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
        dia: { type: Type.INTEGER, nullable: true },
        mes: { type: Type.INTEGER, nullable: true },
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
    negativo: { type: Type.BOOLEAN, nullable: true },
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
const numeroOpcional = z
  .preprocess(
    (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v)),
    z.number().optional(),
  )
  .catch(undefined);

const schema = z.object({
  slots: z
    .object({
      data: z.string().optional(),
      mesDia: z
        .string()
        .regex(/^\d{2}-\d{2}$/)
        .optional()
        .catch(undefined),
      dia: z
        .preprocess(
          (v) => (v === null || v === undefined || v === '' ? undefined : Number(v)),
          z.number().int().min(1).max(31).optional(),
        )
        .catch(undefined),
      mes: z
        .preprocess(
          (v) => (v === null || v === undefined || v === '' ? undefined : Number(v)),
          z.number().int().min(1).max(12).optional(),
        )
        .catch(undefined),
      // Ano fora de 2027/2028 (o modelo às vezes devolve 2026, 2029, etc.) vira
      // undefined em vez de derrubar todo o parse — a máquina de estados então
      // pergunta o ano normalmente. `.catch` é a rede de segurança.
      ano: z
        .preprocess((v) => {
          if (v === null || v === undefined || v === '') return undefined;
          const n = Number(v);
          // "27"/"28" (dois dígitos) valem por 2027/2028.
          if (n === 27 || n === 2027) return 2027;
          if (n === 28 || n === 2028) return 2028;
          return n;
        }, z.union([z.literal(2027), z.literal(2028)]).optional())
        .catch(undefined),
      diaSemana: z.enum(DIAS).optional(),
      preferenciaDia: z.enum(['fim_de_semana', 'dia_de_semana']).optional(),
      convidados: numeroOpcional,
    })
    .default({}),
  intencao: z.enum(INTENCOES).default('seguir_fluxo'),
  afirmativo: z.boolean().optional(),
  negativo: z.boolean().optional(),
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

Use o HISTÓRICO da conversa como contexto para interpretar a NOVA mensagem, especialmente:
- respostas curtas ("sim", "não", "esse", "pode ser", "o segundo") só fazem sentido à luz da última pergunta da Raquel: marque afirmativo/negativo conforme o que ela está aceitando ou recusando.
- referências ao que já foi dito ("e para 2028?", "e se for domingo?", "e mais barato?") reaproveitam os dados anteriores: extraia só o que mudou (aqui, o ano).
- não re-extraia como convidados um número que já foi coletado, nem confunda o dia do evento com o nº de convidados (veja os dados já coletados).

Extraia (deixe null o que a mensagem não disser):
- slots.data: data do evento em ISO (yyyy-mm-dd) apenas se houver data completa com dia, mês e ano.
- slots.mesDia: dia e mês SEM ano, no formato "MM-DD", quando a noiva disser dia E mês JUNTOS (ex.: "26 de janeiro" -> "01-26", "30 de outubro" -> "10-30"). Deixe null se ela já deu o ano (use data) ou se não citou dia e mês juntos.
- slots.mes: número do mês (1-12) quando ela citar SÓ o mês, sem o dia (ex.: "penso em outubro" -> 10). Deixe null se já deu dia e mês juntos (use mesDia).
- slots.dia: número do dia do mês (1-31) quando ela citar SÓ o dia, sem o mês. Em especial, se já perguntamos a DATA e a mensagem é só um número (ex.: "30", "dia 12"), é o dia do evento -> slots.dia. Deixe null se não for um dia de evento.
- slots.ano: 2027 ou 2028, se citado (inclusive dentro de uma data). Aceite dois dígitos: "28" -> 2028, "27" -> 2027.
- slots.diaSemana: o dia da semana exato, se citado (ex.: "sábado" -> sabado, sem acento).
- slots.preferenciaDia: "fim_de_semana" (sábado/domingo) ou "dia_de_semana" (segunda a sexta),
  quando a pessoa fala de forma genérica sem citar o dia exato.
- slots.convidados: número estimado de convidados, SÓ quando o número se refere claramente a pessoas ("150 convidados", "somos uns 200", "200 pessoas"). Um número solto logo depois de perguntarmos a DATA é o dia do evento (slots.dia), NÃO convidados. Nunca reinterprete um número como convidados se "Dados já coletados" já traz convidados e a mensagem não fala de pessoas.
- intencao:
  - "cliente_fechado": dá a entender que JÁ contratou/fechou o casamento.
  - "agendar_visita": a noiva/cliente quer conhecer o espaço (visita normal).
  - "visita_tecnica": é um FORNECEDOR (buffet, decorador, assessoria) de um casamento JÁ FECHADO nesse espaço querendo fazer a VISITA TÉCNICA em si. Use só quando a pessoa fala explicitamente em "visita técnica" para um evento que vai acontecer aqui.
  - "fornecedor": a pessoa NÃO é noiva buscando orçamento — é fornecedor, parceria comercial, imprensa, candidato a vaga ou similar, geralmente com dúvidas para tirar (ex.: "sou fornecedor, preciso tirar dúvidas", "trabalho com decoração e queria conversar", "sou de uma empresa e queria uma parceria"). Precisa de atendimento humano. Não confunda com "visita_tecnica".
  - "negociar": quer desconto, parcelamento ou mudar condição de valor.
  - "despedida": está encerrando o assunto ou se despedindo, sem pedir mais nada ("obrigada, era só isso", "por enquanto é isso", "depois eu vejo", "vou pensar e te aviso", "tchau", "valeu"). Diferente de uma dúvida nova.
  - "fora_do_script": uma PERGUNTA concreta que foge do atendimento padrão (ex.: "tem buffet?", "tem estacionamento?", "qual o endereço?", "aceita pet?"). NÃO use para saudações, agradecimentos, nem quando a pessoa só diz que vai responder, pede um minuto ou manda uma mensagem social — isso é "seguir_fluxo".
  - "seguir_fluxo": caso geral. Inclui informar dados, cumprimentar, agradecer, dizer que vai mandar as informações, pedir um minuto/momento, ou pedir orçamento.
- afirmativo: true quando a mensagem é uma resposta POSITIVA ou de aceite a uma pergunta de sim/não. Reconheça muitas formas, não só "sim": "quero", "pode mandar", "manda", "pode ser", "por favor", "claro", "com certeza", "aceito", "isso", "ok", "bora", "vamos", "sim por favor", "gostaria sim". Se a pessoa está claramente concordando/pedindo para prosseguir, marque true.
- negativo: true quando a mensagem RECUSA ou nega uma pergunta de sim/não, ou adia. Reconheça muitas formas, não só "não": "por enquanto não", "agora não", "não obrigada", "depois", "deixa pra depois", "vou pensar", "ainda não", "talvez mais pra frente", "no momento não". Marque afirmativo OU negativo, nunca os dois. Se a mensagem traz um dado novo (uma data, um número, outra pergunta), não marque nenhum dos dois.
- visita: SÓ quando o estado for "aguardando_pref_visita" (a noiva está dizendo que dia prefere para a visita ao espaço). Preencha:
  - visita.diaSemana: dia da semana que ela prefere (ex.: "quinta" -> quinta).
  - visita.periodo: "manha" ou "tarde", se ela indicar.
  - visita.indiferente: true se ela disser que tanto faz / qualquer dia / você que escolhe.
  Nesse estado, a intenção é "seguir_fluxo" ou "agendar_visita", a não ser que claramente negocie valor ou saia do assunto.
- No estado "visita_tecnica_data" a pessoa está informando a DATA da visita técnica: extraia data/mesDia/ano normalmente e mantenha a intenção "visita_tecnica".
- nomeDetectado: o PRIMEIRO nome da pessoa, sempre que ela se apresentar ("me chamo Maria", "sou a Ana", "aqui é a Júlia", "meu nome é Beatriz Souza" -> "Beatriz"). Só o nome dela; não invente nem extraia nome de terceiros (noivo, fornecedor). null se ela não se apresentou.
- dataEventoDetectada: a data do evento quando a pessoa dá a entender que é cliente já fechado (para casar o cadastro dela).`;

export class GeminiNLU implements NLU {
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error('GEMINI_API_KEY ausente para GeminiNLU');
    this.client = new GoogleGenAI({ apiKey });
  }

  async analisar(
    texto: string,
    conversa: Conversa,
    historico: MensagemLog[] = [],
  ): Promise<EntradaNLU> {
    const resp = await this.client.models.generateContent({
      model: MODELO,
      contents:
        `Conversa até aqui (mais antiga primeiro):\n${formatarHistorico(historico)}\n\n` +
        `Estado atual da conversa: ${conversa.estado}.\n` +
        `Dados já coletados: ${JSON.stringify(conversa.slots)}.\n` +
        `NOVA mensagem da noiva (é esta que você deve interpretar, usando o histórico só como contexto): "${texto}"`,
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
    // Rede final: um retorno inesperado do modelo nunca deve travar a conversa.
    // Se o parse falhar mesmo com os campos tolerantes, degrada para "seguir_fluxo".
    const parsed = schema.safeParse(json);
    return (parsed.success ? parsed.data : { slots: {}, intencao: 'seguir_fluxo' }) as EntradaNLU;
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
