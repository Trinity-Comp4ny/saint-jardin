// Validação da assinatura X-Hub-Signature-256 do webhook da Meta.
// Garante que o POST veio mesmo da Meta (assinado com o App Secret).

import { createHmac, timingSafeEqual } from 'node:crypto';

export function assinaturaValida(
  corpoBruto: string,
  header: string | null | undefined,
  appSecret: string,
): boolean {
  if (!header) return false;
  const esperado =
    'sha256=' + createHmac('sha256', appSecret).update(corpoBruto, 'utf8').digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Verificação do handshake GET do webhook (hub.challenge). */
export function verificarHandshake(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  const modo = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (modo === 'subscribe' && token === verifyToken && challenge) {
    return challenge;
  }
  return null;
}
