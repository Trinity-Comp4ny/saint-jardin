// Pipeline da Fase 1: ingestão do webhook -> fila (com delay) -> processamento.
// Separado do webhook HTTP para ser testável e reaproveitável.

import { parseWebhook } from '../whatsapp/parseWebhook';
import { processarMensagem, type Deps } from './orchestrator';
import type { EventStore, Fila } from '../ports';
import type { Transcriber } from '../adapters/GroqTranscriber';

/** Adiciona `segundos` a um instante ISO. Puro (testável). */
export function adiarISO(agoraISO: string, segundos: number): string {
  return new Date(new Date(agoraISO).getTime() + segundos * 1000).toISOString();
}

export interface IngestDeps {
  eventos: EventStore;
  fila: Fila;
  agora: () => string;
  /** Delay proposital base antes de responder, para não parecer bot. */
  delaySegundos?: number;
  /** Variação aleatória adicionada ao delay (0..jitter s), para não ser fixo. */
  jitterSegundos?: number;
  /** Fonte de aleatoriedade [0,1) (injetável para testes). */
  rng?: () => number;
}

/**
 * Recebe o corpo do webhook, deduplica e enfileira cada mensagem com delay.
 * O delay é base + jitter aleatório: respostas em tempo humano e variável.
 * Retorna quantas mensagens foram enfileiradas.
 */
export async function ingerirWebhook(body: unknown, deps: IngestDeps): Promise<number> {
  const mensagens = parseWebhook(body);
  const base = deps.delaySegundos ?? 60;
  const jitterMax = deps.jitterSegundos ?? 0;
  const rng = deps.rng ?? Math.random;
  let enfileiradas = 0;

  for (const msg of mensagens) {
    if (msg.tipo === 'outro') continue;
    if (await deps.eventos.jaVisto(msg.messageId)) continue;
    await deps.eventos.marcar(msg.messageId);

    const conteudo = msg.tipo === 'audio' ? (msg.mediaId ?? '') : (msg.texto ?? '');
    if (!conteudo) continue;

    const jitter = jitterMax > 0 ? Math.floor(rng() * (jitterMax + 1)) : 0;
    await deps.fila.enfileirar({
      telefone: msg.de,
      tipo: msg.tipo,
      conteudo,
      processarApos: adiarISO(deps.agora(), base + jitter),
      mensagemId: msg.messageId,
    });
    enfileiradas++;
  }

  return enfileiradas;
}

export interface ProcessDeps {
  fila: Fila;
  transcriber: Transcriber;
  orquestrador: Deps;
  limite?: number;
}

/**
 * Processa os itens vencidos da fila (chamado pelo pg_cron a cada minuto).
 * AGRUPA as mensagens do mesmo telefone (rajada: "Boa tarde" + "tudo bem?" +
 * "vou passar") num único turno, para o bot responder uma vez com todo o
 * contexto, em vez de uma resposta por mensagem. Transcreve áudio quando preciso.
 * Retorna quantos turnos (telefones) foram processados.
 */
export async function processarFila(deps: ProcessDeps): Promise<number> {
  const agora = deps.orquestrador.agora();
  const itens = await deps.fila.pegarVencidas(agora, deps.limite ?? 20);

  // Agrupa por telefone preservando a ordem de chegada.
  const grupos = new Map<string, typeof itens>();
  for (const item of itens) {
    const arr = grupos.get(item.telefone) ?? [];
    arr.push(item);
    grupos.set(item.telefone, arr);
  }

  let turnos = 0;
  for (const [telefone, grupo] of grupos) {
    try {
      const partes: string[] = [];
      for (const item of grupo) {
        const texto =
          item.tipo === 'audio'
            ? await deps.transcriber.transcrever(item.conteudo)
            : item.conteudo;
        if (texto) partes.push(texto);
      }
      const mensagem = partes.join('\n');
      if (mensagem) {
        const { conversa } = await processarMensagem(telefone, mensagem, deps.orquestrador);
        // Read/unread na caixa da Raquel: se a conversa precisa dela (handoff) ou
        // já está com ela (humano), deixa NÃO LIDA para ela ver; caso contrário o
        // bot resolveu sozinho, então marca a última mensagem do turno como lida.
        if (conversa.estado !== 'handoff' && conversa.estado !== 'humano') {
          const ultimoId = [...grupo].reverse().find((i) => i.mensagemId)?.mensagemId;
          if (ultimoId) await deps.orquestrador.messaging.marcarLido(ultimoId);
        }
      }
    } finally {
      for (const item of grupo) await deps.fila.marcarProcessado(item.id);
    }
    turnos++;
  }

  return turnos;
}
