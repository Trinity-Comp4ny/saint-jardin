// Repositórios Supabase (Postgres). Implementam as portas do núcleo.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Calendario,
  ContatoRepository,
  ConversaRepository,
  DirecaoMensagem,
  EventStore,
  Fila,
  ItemFila,
  MensagemRepo,
  TipoMensagemLog,
} from '../ports';
import type { Contato, Conversa, Slots, StatusContato } from '../domain/types';

export function criarSupabase(url: string, serviceRoleKey: string): SupabaseClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export class SupabaseContatoRepo implements ContatoRepository {
  constructor(private readonly db: SupabaseClient) {}

  async buscarPorTelefone(telefone: string): Promise<Contato | null> {
    const { data } = await this.db
      .from('contatos')
      .select('telefone, nome, status, data_evento')
      .eq('telefone', telefone)
      .maybeSingle();
    return data ? mapContato(data) : null;
  }

  async buscarPorNomeOuData(nome?: string, dataEvento?: string): Promise<Contato | null> {
    let query = this.db.from('contatos').select('telefone, nome, status, data_evento');
    if (nome && dataEvento) query = query.or(`nome.ilike.${nome},data_evento.eq.${dataEvento}`);
    else if (nome) query = query.ilike('nome', nome);
    else if (dataEvento) query = query.eq('data_evento', dataEvento);
    else return null;

    const { data } = await query.limit(1).maybeSingle();
    return data ? mapContato(data) : null;
  }
}

export class SupabaseConversaRepo implements ConversaRepository {
  constructor(private readonly db: SupabaseClient) {}

  async obter(telefone: string): Promise<Conversa | null> {
    const { data } = await this.db
      .from('conversas')
      .select('telefone, estado, slots, motivo_handoff, criado_em, atualizado_em')
      .eq('telefone', telefone)
      .maybeSingle();
    return data ? mapConversa(data) : null;
  }

  async salvar(conversa: Conversa): Promise<void> {
    const { error } = await this.db.from('conversas').upsert(
      {
        telefone: conversa.telefone,
        estado: conversa.estado,
        slots: conversa.slots,
        motivo_handoff: conversa.motivoHandoff ?? null,
        criado_em: conversa.criadoEm,
        atualizado_em: conversa.atualizadoEm,
      },
      { onConflict: 'telefone' },
    );
    if (error) throw new Error(`salvar conversa: ${error.message}`);
  }
}

export class SupabaseMensagemRepo implements MensagemRepo {
  constructor(private readonly db: SupabaseClient) {}

  async registrar(
    telefone: string,
    direcao: DirecaoMensagem,
    tipo: TipoMensagemLog,
    conteudo: string,
  ): Promise<void> {
    const { error } = await this.db
      .from('mensagens')
      .insert({ telefone, direcao, tipo, conteudo });
    if (error) throw new Error(`registrar mensagem: ${error.message}`);
  }
}

export class SupabaseEventStore implements EventStore {
  constructor(private readonly db: SupabaseClient) {}

  async jaVisto(messageId: string): Promise<boolean> {
    const { data } = await this.db
      .from('eventos_processados')
      .select('message_id')
      .eq('message_id', messageId)
      .maybeSingle();
    return data !== null;
  }

  async marcar(messageId: string): Promise<void> {
    await this.db.from('eventos_processados').insert({ message_id: messageId });
  }
}

export class SupabaseFila implements Fila {
  constructor(private readonly db: SupabaseClient) {}

  async enfileirar(item: Omit<ItemFila, 'id'>): Promise<void> {
    const { error } = await this.db.from('fila_mensagens').insert({
      telefone: item.telefone,
      tipo: item.tipo,
      conteudo: item.conteudo,
      processar_apos: item.processarApos,
    });
    if (error) throw new Error(`enfileirar: ${error.message}`);
  }

  async pegarVencidas(agoraISO: string, limite: number): Promise<ItemFila[]> {
    const { data, error } = await this.db
      .from('fila_mensagens')
      .select('id, telefone, tipo, conteudo, processar_apos')
      .is('processado_em', null)
      .lte('processar_apos', agoraISO)
      .order('processar_apos', { ascending: true })
      .limit(limite);
    if (error) throw new Error(`pegarVencidas: ${error.message}`);
    return (data ?? []).map((r) => ({
      id: String(r.id),
      telefone: String(r.telefone),
      tipo: r.tipo === 'audio' ? 'audio' : 'texto',
      conteudo: String(r.conteudo ?? ''),
      processarApos: String(r.processar_apos),
    }));
  }

  async marcarProcessado(id: string): Promise<void> {
    await this.db
      .from('fila_mensagens')
      .update({ processado_em: new Date().toISOString() })
      .eq('id', id);
  }
}

/**
 * Disponibilidade lida da tabela `disponibilidade` (espelho livre/ocupado).
 * Na Fase futura essa tabela é sincronizada com o Google Calendar dedicado.
 */
export class SupabaseCalendario implements Calendario {
  constructor(private readonly db: SupabaseClient) {}

  async verificar(dataISO: string): Promise<boolean> {
    const { data } = await this.db
      .from('disponibilidade')
      .select('ocupada')
      .eq('data', dataISO)
      .maybeSingle();
    // Sem registro = tratada como livre.
    return !(data?.ocupada === true);
  }

  async sugerirProxima(dataISO: string): Promise<string> {
    const { data } = await this.db
      .from('disponibilidade')
      .select('data')
      .eq('ocupada', false)
      .gt('data', dataISO)
      .order('data', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.data ? String(data.data) : dataISO;
  }
}

interface LinhaContato {
  telefone: string;
  nome: string | null;
  status: string;
  data_evento: string | null;
}

function mapContato(r: LinhaContato): Contato {
  return {
    telefone: r.telefone,
    nome: r.nome ?? undefined,
    status: (r.status === 'fechado' ? 'fechado' : 'lead') as StatusContato,
    dataEvento: r.data_evento ?? undefined,
  };
}

interface LinhaConversa {
  telefone: string;
  estado: string;
  slots: unknown;
  motivo_handoff: string | null;
  criado_em: string;
  atualizado_em: string;
}

function mapConversa(r: LinhaConversa): Conversa {
  return {
    telefone: r.telefone,
    estado: r.estado as Conversa['estado'],
    slots: (r.slots ?? {}) as Slots,
    motivoHandoff: r.motivo_handoff ?? undefined,
    criadoEm: r.criado_em,
    atualizadoEm: r.atualizado_em,
  };
}
