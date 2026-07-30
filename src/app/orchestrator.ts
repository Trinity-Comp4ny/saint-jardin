// Orquestrador: recebe a mensagem do lead e coordena identificação, NLU,
// disponibilidade de data, a decisão da máquina de estados e os efeitos
// colaterais (enviar mensagens, alertar handoff, persistir).

import { dataCompleta, decidir, novaConversa, type ContextoDecisao } from '../domain/stateMachine';
import type { Conversa, MensagemSaida } from '../domain/types';
import type {
  Calendario,
  ContatoRepository,
  ConversaRepository,
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
): Promise<MensagemSaida[]> {
  if (!deps.redator) return saidas;
  return Promise.all(
    saidas.map(async (s) => {
      if (s.tipo !== 'texto' || !s.humanizar || !s.texto) return s;
      const texto = await deps.redator!.humanizar({ objetivo: s.texto, mensagemCliente });
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

export async function processarMensagem(
  telefone: string,
  texto: string,
  deps: Deps,
): Promise<ResultadoProcessamento> {
  await deps.mensagens?.registrar(telefone, 'entrada', 'texto', texto);

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

  // 2. Leitura da mensagem.
  const nlu = await deps.nlu.analisar(texto, conversaAtual);

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
  const dataAlvo = dataCompleta({
    data: nlu.slots.data ?? conversaAtual.slots.data,
    mesDia: nlu.slots.mesDia ?? conversaAtual.slots.mesDia,
    ano: nlu.slots.ano ?? conversaAtual.slots.ano,
  });
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
  const saidasFinais = await humanizarSaidas(deps, saidas, texto);
  if (saidasFinais.length > 0) {
    await deps.messaging.enviar(telefone, saidasFinais);
    for (const s of saidasFinais) {
      await deps.mensagens?.registrar(
        telefone,
        'saida',
        s.tipo === 'pdf' ? 'pdf' : 'texto',
        s.tipo === 'pdf' ? (s.pdf ?? '') : (s.texto ?? ''),
      );
    }
  }
  await deps.conversas.salvar(conversa);
  // conversaAtual nunca é 'handoff' aqui (guardado no topo), então basta olhar o novo estado.
  // Vale para a visita da noiva e a técnica: ambas terminam em handoff com o motivo pronto.
  if (conversa.estado === 'handoff') {
    await alertarSeguro(deps, conversa, conversa.motivoHandoff ?? 'handoff');
  }

  return { conversa, saidas: saidasFinais };
}
