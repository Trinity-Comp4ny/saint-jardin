// Webhook da WhatsApp Cloud API.
//   GET  -> handshake de verificação (hub.challenge)
//   POST -> recebe mensagens, valida assinatura, deduplica e enfileira
// Responde 200 rápido; o processamento (com delay) roda no /api/process.

import { NextResponse } from 'next/server';
import { assinaturaValida, verificarHandshake } from '../../../src/whatsapp/verifySignature';
import { ingerirWebhook, processarFila } from '../../../src/app/pipeline';
import { montarIngestDeps, montarProcessDeps } from '../../../src/app/deps';

export const runtime = 'nodejs';
// No modo teste o webhook também processa (síncrono), então precisa de folga.
export const maxDuration = 60;

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

  // MODO_TESTE: resposta imediata (delay 0 + processa síncrono, sem esperar o
  // cron). Em produção: enfileira com delay base + jitter e o cron processa.
  const teste = process.env.MODO_TESTE === 'true';

  const { eventos, fila } = montarIngestDeps();
  const enfileiradas = await ingerirWebhook(body, {
    eventos,
    fila,
    agora: () => new Date().toISOString(),
    delaySegundos: teste ? 0 : Number(process.env.DELAY_SEGUNDOS ?? '60'),
    jitterSegundos: teste ? 0 : Number(process.env.JITTER_SEGUNDOS ?? '0'),
  });

  if (teste && enfileiradas > 0) {
    await processarFila(montarProcessDeps());
  }

  return NextResponse.json({ ok: true, enfileiradas });
}
