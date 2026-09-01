// Pipeline da Fase 1: ingestão do webhook -> fila (com delay) -> processamento.
// Separado do webhook HTTP para ser testável e reaproveitável.

import { parseWebhook } from '../whatsapp/parseWebhook';
import { processarMensagem, type Deps } from './orchestrator';
import { novaConversa } from '../domain/stateMachine';
import { MSG } from '../domain/persona';
import type { Conversa } from '../domain/types';
import type { EventStore, Fila, Transcriber } from '../ports';

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
 * Transcrição do áudio falhou (Gemini indisponível, rate limit, formato etc.): sem
 * isso, o item era marcado como processado e a mensagem sumia sem resposta nem
 * aviso para a Raquel. Avisa a noiva (pede texto) e dispara handoff. Best-effort:
 * uma falha aqui não pode derrubar o resto da fila.
 */
async function avisarFalhaTranscricao(deps: Deps, telefone: string): Promise<void> {
  try {
    const conversa = (await deps.conversas.obter(telefone)) ?? novaConversa(telefone, deps.agora());
    const motivo = 'áudio recebido, mas a transcrição falhou';
    const atualizada: Conversa = {
      ...conversa,
      estado: 'handoff',
      motivoHandoff: motivo,
      atualizadoEm: deps.agora(),
    };
    await deps.conversas.salvar(atualizada);
    await deps.messaging.enviar(telefone, [{ tipo: 'texto', texto: MSG.audioNaoEntendido }]);
    await deps.notifier.alertarHandoff(atualizada, motivo);
  } catch {
    // Nada mais a fazer: o item já será marcado como processado no finally do
    // chamador; ao menos tentamos avisar os dois lados antes de desistir.
  }
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
      let falhaAudio = false;
      for (const item of grupo) {
        if (item.tipo === 'audio') {
          try {
            const texto = await deps.transcriber.transcrever(item.conteudo);
            if (texto) partes.push(texto);
          } catch {
            falhaAudio = true;
          }
        } else if (item.conteudo) {
          partes.push(item.conteudo);
        }
      }

      if (falhaAudio) {
        // Não segue para o NLU com contexto incompleto: a conversa já vai para
        // handoff, e o orquestrador ignoraria a mensagem mesmo (estado 'handoff').
        await avisarFalhaTranscricao(deps.orquestrador, telefone);
      } else {
        const mensagem = partes.join('\n');
        if (mensagem) {
          // Passa o id da última mensagem da rajada: o orquestrador cuida do
          // read/unread e do "digitando" (marca lido só quando o bot resolve, não
          // em handoff, para a conversa que precisa da Raquel ficar não lida).
          const ultimoId = [...grupo].reverse().find((i) => i.mensagemId)?.mensagemId;
          await processarMensagem(telefone, mensagem, deps.orquestrador, ultimoId);
        }
      }
    } finally {
      for (const item of grupo) await deps.fila.marcarProcessado(item.id);
    }
    turnos++;
  }

  return turnos;
}
