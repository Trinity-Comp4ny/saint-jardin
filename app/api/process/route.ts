// Processa a fila de mensagens vencidas. Chamado pelo pg_cron a cada minuto
// (via pg_net) ou por um scheduler. Protegido por um segredo simples.

import { NextResponse } from 'next/server';
import { processarFila } from '../../../src/app/pipeline';
import { montarProcessDeps } from '../../../src/app/deps';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const segredo = req.headers.get('x-process-secret');
  if (segredo !== process.env.PROCESS_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const { fila, transcriber, orquestrador } = montarProcessDeps();
  const processados = await processarFila({ fila, transcriber, orquestrador });

  return NextResponse.json({ ok: true, processados });
}
