// Processa a fila de mensagens vencidas. Chamado pelo pg_cron a cada minuto
// (via pg_net) ou por um scheduler. Protegido por um segredo simples.

import { NextResponse } from 'next/server';
import { processarFila } from '../../../src/app/pipeline';
import { processarFollowups } from '../../../src/app/followup';
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

  // Follow-up da proposta (12h): isolado, uma falha aqui não derruba o resultado da fila.
  let followups = 0;
  try {
    followups = await processarFollowups(orquestrador);
  } catch (erro) {
    console.error('process: falha nos follow-ups', erro);
  }

  return NextResponse.json({ ok: true, processados, followups });
}
