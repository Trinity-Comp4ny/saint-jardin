// Parser puro do payload do webhook da WhatsApp Cloud API.
// Normaliza o JSON da Meta em mensagens simples. Testável sem rede.

export type TipoMensagemEntrada = 'texto' | 'audio' | 'outro';

export interface MensagemEntrada {
  messageId: string;
  de: string; // telefone do remetente (wa_id)
  tipo: TipoMensagemEntrada;
  texto?: string;
  mediaId?: string;
  timestamp?: string;
}

/**
 * Extrai as mensagens de um corpo de webhook da Meta.
 * Ignora eventos que não são mensagens de usuário (status de entrega, etc.).
 */
export function parseWebhook(body: unknown): MensagemEntrada[] {
  const resultado: MensagemEntrada[] = [];
  const entradas = getArray(body, 'entry');

  for (const entry of entradas) {
    for (const change of getArray(entry, 'changes')) {
      const value = getObj(change, 'value');
      if (!value) continue;
      for (const msg of getArray(value, 'messages')) {
        const parsed = parseMensagem(msg);
        if (parsed) resultado.push(parsed);
      }
    }
  }
  return resultado;
}

function parseMensagem(msg: unknown): MensagemEntrada | null {
  if (!isObj(msg)) return null;
  const messageId = asString(msg['id']);
  const de = asString(msg['from']);
  const tipoBruto = asString(msg['type']);
  if (!messageId || !de) return null;

  const timestamp = asString(msg['timestamp']);

  if (tipoBruto === 'text') {
    const textObj = getObj(msg, 'text');
    return {
      messageId,
      de,
      tipo: 'texto',
      texto: textObj ? asString(textObj['body']) : undefined,
      timestamp,
    };
  }

  if (tipoBruto === 'audio') {
    const audioObj = getObj(msg, 'audio');
    return {
      messageId,
      de,
      tipo: 'audio',
      mediaId: audioObj ? asString(audioObj['id']) : undefined,
      timestamp,
    };
  }

  return { messageId, de, tipo: 'outro', timestamp };
}

// helpers de acesso seguro a JSON desconhecido

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function getObj(v: unknown, chave: string): Record<string, unknown> | undefined {
  if (!isObj(v)) return undefined;
  const val = v[chave];
  return isObj(val) ? val : undefined;
}

function getArray(v: unknown, chave: string): unknown[] {
  if (!isObj(v)) return [];
  const val = v[chave];
  return Array.isArray(val) ? val : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
