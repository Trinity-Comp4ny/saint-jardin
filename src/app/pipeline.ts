// Pipeline da Fase 1: ingestão do webhook -> fila (com delay) -> processamento.
// Separado do webhook HTTP para ser testável e reaproveitável.

import { parseWebhook } from '../whatsapp/parseWebhook';
import { contemComandoReset, processarMensagem, type Deps } from './orchestrator';
import { novaConversa } from '../domain/stateMachine';
import { MSG } from '../domain/persona';
import type { Conversa } from '../domain/types';
import type { EventStore, Fila, Transcriber, TravaTurno } from '../ports';

/** Adiciona `segundos` a um instante ISO. Puro (testável). */
export function adiarISO(agoraISO: string, segundos: number): string {
  return new Date(new Date(agoraISO).getTime() + segundos * 1000).toISOString();
}

// Cap de tamanho por mensagem: nenhuma conversa real de orçamento precisa de
// mais que isso. Sem cap, uma mensagem de texto gigante (ou um áudio muito
// longo transcrito) multiplica o custo de tokens da chamada ao Gemini dentro
// do próprio limite de CONTAGEM de mensagens (ADR-0009) — o rate limit por
// contagem não protege contra tamanho.
const MAX_CARACTERES_MENSAGEM = 4000;

/**
 * Lê um número de env var com fallback seguro. `??` só cobre undefined/null —
 * `RATE_LIMIT_MAX_MENSAGENS=""` (var criada mas vazia) virava `Number('')` = 0,
 * o que bloqueava TODA mensagem de todo mundo silenciosamente; e um typo tipo
 * "abc" virava NaN, que desligava o rate limit sem avisar. Trata os três casos
 * (ausente, vazio, não numérico) como "usar o default".
 */
export function numeroEnv(valor: string | undefined, valorPadrao: number): number {
  if (!valor) return valorPadrao;
  const n = Number(valor);
  return Number.isFinite(n) ? n : valorPadrao;
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
  /**
   * Rate limit por telefone (ADR-0009): protege contra custo de LLM disparado
   * por abuso (spam de mensagens/áudio pelo número real da Raquel). Acima do
   * limite, a mensagem é descartada sem enfileirar (idempotência já registrada).
   */
  limiteMensagens?: number; // default 30
  janelaLimiteMinutos?: number; // default 60
}

/**
 * Recebe o corpo do webhook, deduplica e enfileira cada mensagem com delay.
 * O delay é base + jitter aleatório: respostas em tempo humano e variável.
 * Retorna quantas mensagens foram enfileiradas.
 */
export async function ingerirWebhook(body: unknown, deps: IngestDeps): Promise<number> {
  const mensagens = parseWebhook(body);
  // Clamps de configuração: delay/jitter nunca negativos; limite e janela nunca
  // zerados/negativos (um limite ≤ 0 por env torta bloquearia TODO mundo em
  // silêncio — a mesma classe de falha que `numeroEnv` já protege).
  const base = Math.max(0, deps.delaySegundos ?? 60);
  const jitterMax = Math.max(0, deps.jitterSegundos ?? 0);
  const rng = deps.rng ?? Math.random;
  const limite = Math.max(1, deps.limiteMensagens ?? 30);
  const janelaSegundos = Math.max(60, (deps.janelaLimiteMinutos ?? 60) * 60);
  let enfileiradas = 0;

  for (const msg of mensagens) {
    // Dedup ATÔMICO: `marcar` é o próprio check-and-set (via constraint de
    // unicidade no banco), não duas chamadas separadas com janela de corrida
    // entre elas. Sob reentrega concorrente real da Meta pro mesmo messageId,
    // só uma das chamadas recebe `true`.
    const primeiraVez = await deps.eventos.marcar(msg.messageId);
    if (!primeiraVez) continue;

    try {
      // 'outro' = figurinha, reação, imagem, documento, localização etc. Sem
      // conteúdo de texto real pra extrair, mas ainda entra na fila: sem isso a
      // noiva que reage com 👍 (achando que respondeu) fica sem retorno nenhum,
      // achando que travou (`processarFila` avisa que só entende texto/áudio).
      const conteudo =
        msg.tipo === 'audio'
          ? (msg.mediaId ?? '')
          : msg.tipo === 'outro'
            ? 'outro'
            : (msg.texto ?? '').slice(0, MAX_CARACTERES_MENSAGEM);
      if (!conteudo) continue;

      const desdeISO = adiarISO(deps.agora(), -janelaSegundos);
      const recentes = await deps.fila.contarRecentes(msg.de, desdeISO);
      if (recentes >= limite) continue; // acima do limite na janela: descarta

      const jitter = jitterMax > 0 ? Math.floor(rng() * (jitterMax + 1)) : 0;
      await deps.fila.enfileirar({
        telefone: msg.de,
        tipo: msg.tipo,
        conteudo,
        processarApos: adiarISO(deps.agora(), base + jitter),
        mensagemId: msg.messageId,
      });
      enfileiradas++;
    } catch (erro) {
      // Falhou DEPOIS do dedup (fila/rate-limit fora do ar): solta a marca pra
      // reentrega da Meta poder processar esta mensagem. Sem isso ela morria
      // marcada como vista e nunca era respondida. As mensagens JÁ enfileiradas
      // deste mesmo webhook continuam marcadas (a reentrega pula elas) — e o
      // rethrow vira 500 no webhook, que é o que faz a Meta reentregar.
      try {
        await deps.eventos.desmarcar(msg.messageId);
      } catch {
        // Melhor esforço: se nem a compensação foi, não há mais o que fazer aqui.
      }
      throw erro;
    }
  }

  return enfileiradas;
}

// A trava vive mais que o maxDuration das rotas (60 s): um turno que morreu sem
// liberar não bloqueia o número por mais que isso. Quem espera desiste antes do
// próprio maxDuration, devolve os itens à fila e deixa o próximo ciclo tentar.
const TRAVA_TTL_SEGUNDOS = 65;
const TRAVA_ESPERA_MS = 45_000;
const TRAVA_INTERVALO_MS = 1_000;

const pausaReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface ProcessDeps {
  fila: Fila;
  transcriber: Transcriber;
  orquestrador: Deps;
  limite?: number;
  /** Um turno por telefone por vez. Ausente = sem trava (sandbox e testes simples). */
  trava?: TravaTurno;
  /** Espera máxima pela trava de outro turno (injetável para testes). */
  esperaTravaMs?: number;
  /** Pausa entre tentativas de pegar a trava (injetável para testes). */
  pausar?: (ms: number) => Promise<void>;
}

/**
 * Espera o turno anterior do mesmo telefone terminar e assume a trava. Devolve a
 * função que libera, ou `null` se estourou a espera. Se a própria trava falhar
 * (tabela ausente, banco fora), segue sem ela: perder a resposta de uma noiva
 * é pior que o risco de sobreposição que a trava evita.
 */
async function assumirTurno(deps: ProcessDeps, telefone: string): Promise<(() => Promise<void>) | null> {
  const semTrava = async () => {};
  if (!deps.trava) return semTrava;
  const pausar = deps.pausar ?? pausaReal;
  const tentativas = Math.max(1, Math.ceil((deps.esperaTravaMs ?? TRAVA_ESPERA_MS) / TRAVA_INTERVALO_MS));

  for (let i = 0; i < tentativas; i++) {
    try {
      const token = await deps.trava.adquirir(telefone, TRAVA_TTL_SEGUNDOS);
      if (token) {
        return async () => {
          try {
            await deps.trava!.liberar(telefone, token);
          } catch {
            // Sem liberar: a trava expira sozinha em TRAVA_TTL_SEGUNDOS.
          }
        };
      }
    } catch (erro) {
      console.error(`processarFila: trava indisponível para ${telefone}, seguindo sem ela`, erro);
      return semTrava;
    }
    if (i < tentativas - 1) await pausar(TRAVA_INTERVALO_MS);
  }
  return null;
}

/**
 * Avisa a noiva e dispara handoff. Usado tanto quando a transcrição falha
 * quanto (rede de segurança) quando qualquer outra etapa do turno lança uma
 * exceção inesperada: sem isso, o item era marcado como processado e a
 * mensagem sumia sem resposta nem aviso para a Raquel. Best-effort: uma falha
 * aqui não pode derrubar o resto da fila.
 */
async function avisarEHandoff(
  deps: Deps,
  telefone: string,
  motivo: string,
  mensagemCliente: string,
): Promise<void> {
  try {
    const conversa = (await deps.conversas.obter(telefone)) ?? novaConversa(telefone, deps.agora());
    const atualizada: Conversa = {
      ...conversa,
      estado: 'handoff',
      motivoHandoff: motivo,
      atualizadoEm: deps.agora(),
    };
    await deps.conversas.salvar(atualizada);
    await deps.messaging.enviar(telefone, [{ tipo: 'texto', texto: mensagemCliente }]);
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
    const liberarTurno = await assumirTurno(deps, telefone);
    if (!liberarTurno) {
      // Outro turno deste número ainda roda: devolve os itens e o próximo ciclo
      // (cron ou próxima mensagem) processa, já com o estado salvo pelo anterior.
      for (const item of grupo) {
        try {
          await deps.fila.devolver(item.id);
        } catch (erro) {
          console.error(`processarFila: não devolveu o item ${item.id} à fila`, erro);
        }
      }
      continue;
    }
    try {
      // Conversa já com a Raquel: nem transcreve. Sem essa checagem, um número
      // que já caiu em handoff (ex.: pergunta fora do script) podia continuar
      // mandando áudio e cada um custava uma chamada de transcrição de graça —
      // o orquestrador só ignoraria a mensagem DEPOIS dela já ter sido paga.
      // Best-effort: se a checagem falhar (rede), assume que NÃO está em handoff
      // (falha aberto aqui, não fechado — não vale perder resposta de cliente
      // real por causa de uma falha transitória nesta checagem extra).
      let jaComARaquel = false;
      try {
        const conversaAtual = await deps.orquestrador.conversas.obter(telefone);
        jaComARaquel = conversaAtual?.estado === 'handoff' || conversaAtual?.estado === 'humano';
      } catch {
        jaComARaquel = false;
      }

      // Exceção: o #reset do número de teste passa mesmo em handoff (senão o teste fica preso).
      const pedeReset =
        deps.orquestrador.numerosTeste?.includes(telefone) === true &&
        grupo.some((i) => i.tipo === 'texto' && contemComandoReset(i.conteudo));

      if (!jaComARaquel || pedeReset) {
        const partes: string[] = [];
        let falhaAudio = false;
        let temTipoNaoSuportado = false;
        for (const item of grupo) {
          if (item.tipo === 'audio') {
            try {
              const texto = await deps.transcriber.transcrever(item.conteudo);
              if (texto) partes.push(texto.slice(0, MAX_CARACTERES_MENSAGEM));
            } catch {
              falhaAudio = true;
            }
          } else if (item.tipo === 'outro') {
            temTipoNaoSuportado = true;
          } else if (item.conteudo) {
            partes.push(item.conteudo);
          }
        }

        if (falhaAudio) {
          // Não segue para o NLU com contexto incompleto: a conversa já vai para
          // handoff, e o orquestrador ignoraria a mensagem mesmo (estado 'handoff').
          await avisarEHandoff(
            deps.orquestrador,
            telefone,
            'áudio recebido, mas a transcrição falhou',
            MSG.audioNaoEntendido,
          );
        } else {
          const mensagem = partes.join('\n');
          const ultimoId = [...grupo].reverse().find((i) => i.mensagemId)?.mensagemId;
          if (mensagem) {
            // Passa o id da última mensagem da rajada: o orquestrador cuida do
            // read/unread e do "digitando" (marca lido só quando o bot resolve, não
            // em handoff, para a conversa que precisa da Raquel ficar não lida).
            await processarMensagem(telefone, mensagem, deps.orquestrador, ultimoId);
          } else if (temTipoNaoSuportado) {
            // Rajada só trouxe figurinha/reação/imagem/documento/localização
            // etc., nada que dê pra ler: avisa que só entende texto/áudio, sem
            // gastar NLU e sem virar handoff (não precisa de humano pra isso).
            if (ultimoId) await deps.orquestrador.messaging.mostrarDigitando(ultimoId);
            await deps.orquestrador.messaging.enviar(telefone, [
              { tipo: 'texto', texto: MSG.tipoNaoSuportado },
            ]);
          }
        }
      }
    } catch (erro) {
      // Rede de segurança do LOTE INTEIRO, não só desse telefone: `pegarVencidas`
      // já reivindica atomicamente TODOS os itens do lote de uma vez (marca
      // processado_em na hora de buscar, não depois de processar). Se uma
      // exceção não tratada escapasse daqui, ela pararia o `for` e os grupos
      // SEGUINTES do mesmo lote sumiriam pra sempre (já contam como
      // processados, mas nunca teriam sido de fato atendidos). Por isso captura
      // aqui, avisa o cliente e a Raquel, e deixa o loop seguir pro próximo
      // telefone. console.error é a única observabilidade disponível hoje
      // (aparece nos runtime logs da Vercel).
      console.error(`processarFila: erro inesperado processando ${telefone}`, erro);
      await avisarEHandoff(
        deps.orquestrador,
        telefone,
        'erro inesperado no processamento',
        MSG.erroInesperado,
      );
    } finally {
      for (const item of grupo) await deps.fila.marcarProcessado(item.id);
      await liberarTurno();
    }
    turnos++;
  }

  return turnos;
}
