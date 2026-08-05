// Orquestrador: recebe a mensagem do lead e coordena identificação, NLU,
// disponibilidade de data, a decisão da máquina de estados e os efeitos
// colaterais (enviar mensagens, alertar handoff, persistir).

import { dataCompleta, decidir, mesclarSlots, novaConversa, type ContextoDecisao } from '../domain/stateMachine';
import type { Conversa, MensagemSaida } from '../domain/types';
import type {
  Calendario,
  ContatoRepository,
  ConversaRepository,
  MensagemLog,
  MensagemRepo,
  MessagingProvider,
  Notifier,
  NLU,
  Redator,
} from '../ports';

export interface Deps {
  contatos: ContatoRepository;
  conversas: ConversaRepository;
  nlu: NLU;
  calendario: Calendario;
  /** Redação humanizada das perguntas/convites (opcional). Ausente = texto literal. */
  redator?: Redator;
  messaging: MessagingProvider;
  notifier: Notifier;
  agora: () => string;
  /** Log de auditoria (opcional): grava entrada e saídas por telefone. */
  mensagens?: MensagemRepo;
  /**
   * Números em modo teste: habilita o comando de reset da conversa (`#reset`),
   * para a Raquel repetir os testes sem ficar presa no handoff. Vazio/ausente em
   * produção — o comando simplesmente não existe fora dos números listados.
   */
  numerosTeste?: string[];
}

export interface ResultadoProcessamento {
  conversa: Conversa;
  saidas: MensagemSaida[];
}

// O alerta de handoff (Telegram) NUNCA deve derrubar o atendimento: se o canal
// falhar ou não estiver configurado, o handoff já está persistido no banco e
// continua visível. Best-effort.
async function alertarSeguro(deps: Deps, conversa: Conversa, motivo: string): Promise<void> {
  try {
    await deps.notifier.alertarHandoff(conversa, motivo);
  } catch {
    // handoff permanece registrado; o alerta é reenviável (watchdog futuro).
  }
}

/**
 * Reescreve as saídas marcadas com `humanizar` na voz da Raquel, respondendo o
 * small talk do cliente. As demais (preço, proposta, regra, PDF) vão intactas.
 * Best-effort: sem redator ou em caso de falha, mantém o texto original.
 */
async function humanizarSaidas(
  deps: Deps,
  saidas: MensagemSaida[],
  mensagemCliente: string,
  historico: MensagemLog[],
  nome?: string,
): Promise<MensagemSaida[]> {
  if (!deps.redator) return saidas;
  return Promise.all(
    saidas.map(async (s, i) => {
      if (s.tipo !== 'texto' || !s.humanizar || !s.texto) return s;
      // Se um texto (ex.: a apresentação, que já saúda) veio antes nesta mesma
      // rajada, a pergunta humanizada não deve saudar de novo (evita "olá" duplo).
      const jaSaudou = saidas.slice(0, i).some((a) => a.tipo === 'texto');
      const texto = await deps.redator!.humanizar({
        objetivo: s.texto,
        mensagemCliente,
        jaSaudou,
        historico,
        nome,
      });
      return { ...s, texto };
    }),
  );
}

async function transbordar(
  deps: Deps,
  conversa: Conversa,
  motivo: string,
): Promise<ResultadoProcessamento> {
  const atualizada: Conversa = {
    ...conversa,
    estado: 'handoff',
    motivoHandoff: motivo,
    atualizadoEm: deps.agora(),
  };
  await deps.conversas.salvar(atualizada);
  await alertarSeguro(deps, atualizada, motivo);
  return { conversa: atualizada, saidas: [] };
}

/** Comandos que zeram a conversa no modo teste (variações do "#reset"). */
const COMANDOS_RESET = new Set(['reset', '#reset', 'resetar', '#resetar']);

export async function processarMensagem(
  telefone: string,
  texto: string,
  deps: Deps,
  /**
   * ID da mensagem recebida na Cloud API (o último `mensagemId` da rajada). Usado
   * para o read/unread e o "digitando": o bot mostra digitando (e marca lido) só
   * quando VAI responder e NÃO é handoff; conversa que precisa da Raquel fica não
   * lida. Ausente no sandbox/testes -> sem efeito de leitura.
   */
  messageId?: string,
): Promise<ResultadoProcessamento> {
  // Histórico ANTES de registrar a mensagem atual: são os turnos anteriores, o
  // contexto da conversa desde o começo. Best-effort (uma falha aqui não derruba
  // o turno; a leitura degrada para "só a mensagem atual").
  let historico: MensagemLog[] = [];
  try {
    historico = (await deps.mensagens?.historico(telefone, 20)) ?? [];
  } catch {
    historico = [];
  }

  await deps.mensagens?.registrar(telefone, 'entrada', 'texto', texto);

  // Comando de teste: só vale para os números em `numerosTeste` (vazio em
  // produção, então inerte). Zera a conversa para recomeçar do 'novo'.
  // A fila agrupa mensagens do mesmo turno com "\n" (ex.: "#reser\n#reset"), então
  // checamos LINHA A LINHA: basta uma ser comando de reset para zerar. Antes, a
  // string juntada não batia com o comando e o bot respondia contra o estado velho.
  const ehComandoReset = texto
    .split('\n')
    .some((linha) => COMANDOS_RESET.has(linha.trim().toLowerCase()));
  if (deps.numerosTeste?.includes(telefone) && ehComandoReset) {
    const zerada = novaConversa(telefone, deps.agora());
    await deps.conversas.salvar(zerada);
    // Apaga o histórico também: senão a NLU/Redator releem os turnos antigos e
    // ressuscitam dados já zerados (ex.: o nome da noiva reaparece no "oi" seguinte).
    await deps.mensagens?.limpar(telefone);
    const aviso: MensagemSaida[] = [
      { tipo: 'texto', texto: 'Conversa zerada. Pode recomeçar o teste. 🧪' },
    ];
    await deps.messaging.enviar(telefone, aviso);
    return { conversa: zerada, saidas: aviso };
  }

  const conversaAtual =
    (await deps.conversas.obter(telefone)) ?? novaConversa(telefone, deps.agora());

  // Conversa já assumida pela Raquel: o bot não responde.
  if (conversaAtual.estado === 'humano' || conversaAtual.estado === 'handoff') {
    return { conversa: conversaAtual, saidas: [] };
  }

  // 1. Cliente já fechado pelo próprio número: nunca é atendido pela IA.
  const contatoPorTelefone = await deps.contatos.buscarPorTelefone(telefone);
  if (contatoPorTelefone?.status === 'fechado') {
    return transbordar(deps, conversaAtual, 'cliente que já fechou (por número)');
  }

  // 2. Leitura da mensagem, com o histórico como contexto.
  const nlu = await deps.nlu.analisar(texto, conversaAtual, historico);

  // 3. Cliente fechado que escreve de número novo: casa por nome/data.
  if (nlu.intencao === 'cliente_fechado' || nlu.nomeDetectado || nlu.dataEventoDetectada) {
    const casado = await deps.contatos.buscarPorNomeOuData(
      nlu.nomeDetectado,
      nlu.dataEventoDetectada,
    );
    if (casado?.status === 'fechado') {
      return transbordar(deps, conversaAtual, 'cliente que já fechou (número novo)');
    }
  }

  // Semente para variar frases repetidas: derivada da mensagem, então respostas
  // diferentes da noiva geram variantes diferentes, sem repetir a mesma frase.
  let seed = 0;
  for (const ch of texto) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;

  // 4. Disponibilidade de data, quando há data específica em jogo (informada
  // completa, ou dia/mês já combinado com o ano ao longo da conversa).
  const ctx: ContextoDecisao = { agora: deps.agora(), seed };
  // Mescla os slots como a máquina de estados fará (inclui combinar mês+dia de
  // turnos diferentes em mesDia), para o check de calendário ver a data completa.
  const dataAlvo = dataCompleta(mesclarSlots(conversaAtual.slots, nlu.slots));
  if (dataAlvo) {
    const livre = await deps.calendario.verificar(dataAlvo);
    ctx.disponibilidadeData = {
      data: dataAlvo,
      livre,
      alternativa: livre ? undefined : await deps.calendario.sugerirProxima(dataAlvo),
    };
  }

  // 5. Decisão determinística.
  const { conversa, saidas } = decidir(conversaAtual, nlu, ctx);

  // 6. Efeitos de mensagem. Antes de enviar, humaniza as perguntas marcadas
  // (só as conversacionais; preço/proposta/regra vão literais).
  const saidasFinais = await humanizarSaidas(deps, saidas, texto, historico, conversa.slots.nome);

  // Read/unread + "digitando" na caixa da Raquel. Só marcamos lido quando o bot
  // resolve o turno (não é handoff): conversa que precisa da Raquel fica não lida.
  const botResolveu = conversa.estado !== 'handoff' && conversa.estado !== 'humano';
  if (saidasFinais.length > 0) {
    // Vai responder: mostra "digitando…" (que já marca lido) antes das mensagens.
    // Em handoff que ainda responde algo (ex.: fornecedor), NÃO digita nem marca
    // lido, para a conversa continuar não lida para a Raquel.
    if (messageId && botResolveu) await deps.messaging.mostrarDigitando(messageId);
    await deps.messaging.enviar(telefone, saidasFinais);
    for (const s of saidasFinais) {
      await deps.mensagens?.registrar(
        telefone,
        'saida',
        s.tipo === 'pdf' ? 'pdf' : 'texto',
        s.tipo === 'pdf' ? (s.pdf ?? '') : (s.texto ?? ''),
      );
    }
  } else if (messageId && botResolveu) {
    // Resolveu em silêncio (ex.: 'encerrada' já quieta): marca lido, sem digitar.
    await deps.messaging.marcarLido(messageId);
  }
  await deps.conversas.salvar(conversa);
  // conversaAtual nunca é 'handoff' aqui (guardado no topo), então basta olhar o novo estado.
  // Vale para a visita da noiva e a técnica: ambas terminam em handoff com o motivo pronto.
  if (conversa.estado === 'handoff') {
    await alertarSeguro(deps, conversa, conversa.motivoHandoff ?? 'handoff');
  }

  return { conversa, saidas: saidasFinais };
}
