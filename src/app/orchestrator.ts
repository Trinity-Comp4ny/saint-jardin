// Orquestrador: recebe a mensagem do lead e coordena identificação, NLU,
// disponibilidade de data, a decisão da máquina de estados e os efeitos
// colaterais (enviar mensagens, alertar handoff, persistir).

import { decidir, novaConversa, type ContextoDecisao } from '../domain/stateMachine';
import type { Conversa, MensagemSaida } from '../domain/types';
import type {
  Calendario,
  ContatoRepository,
  ConversaRepository,
  MensagemRepo,
  MessagingProvider,
  Notifier,
  NLU,
} from '../ports';

export interface Deps {
  contatos: ContatoRepository;
  conversas: ConversaRepository;
  nlu: NLU;
  calendario: Calendario;
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
  await deps.notifier.alertarHandoff(atualizada, motivo);
  await deps.conversas.salvar(atualizada);
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

  // 4. Disponibilidade de data, quando há data específica em jogo.
  const ctx: ContextoDecisao = { agora: deps.agora() };
  const dataAlvo = nlu.slots.data ?? conversaAtual.slots.data;
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

  // 6. Efeitos colaterais.
  if (saidas.length > 0) {
    await deps.messaging.enviar(telefone, saidas);
    for (const s of saidas) {
      await deps.mensagens?.registrar(
        telefone,
        'saida',
        s.tipo === 'pdf' ? 'pdf' : 'texto',
        s.tipo === 'pdf' ? (s.pdf ?? '') : (s.texto ?? ''),
      );
    }
  }
  // conversaAtual nunca é 'handoff' aqui (guardado no topo), então basta olhar o novo estado.
  if (conversa.estado === 'handoff') {
    await deps.notifier.alertarHandoff(conversa, conversa.motivoHandoff ?? 'handoff');
  }
  await deps.conversas.salvar(conversa);

  return { conversa, saidas };
}
