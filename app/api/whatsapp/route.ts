// Webhook da WhatsApp Cloud API.
//   GET  -> handshake de verificação (hub.challenge)
//   POST -> recebe mensagens, valida assinatura, deduplica e enfileira
// Responde 200 rápido; o processamento (com delay) roda no /api/process.

import { NextResponse } from 'next/server';
import { assinaturaValida, verificarHandshake } from '../../../src/whatsapp/verifySignature';
import { ingerirWebhook } from '../../../src/app/pipeline';
import { montarDeps } from '../../../src/app/deps';

export const runtime = 'nodejs';

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const challenge = verificarHandshake(params, process.env.WHATSAPP_VERIFY_TOKEN ?? '');
  if (challenge) return new Response(challenge, { status: 200 });
  return new Response('forbidden', { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  const corpoBruto = await req.text();
  const assinatura = req.headers.get('x-hub-signature-256');

  if (!assinaturaValida(corpoBruto, assinatura, process.env.WHATSAPP_APP_SECRET ?? '')) {
    return new Response('invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(corpoBruto);
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const { eventos, fila } = montarDeps();
  const enfileiradas = await ingerirWebhook(body, {
    eventos,
    fila,
    agora: () => new Date().toISOString(),
    delaySegundos: Number(process.env.DELAY_SEGUNDOS ?? '60'),
  });

  return NextResponse.json({ ok: true, enfileiradas });
}
