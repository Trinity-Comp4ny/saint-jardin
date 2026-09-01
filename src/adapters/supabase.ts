// Repositórios Supabase (Postgres). Implementam as portas do núcleo.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AgendaVisita,
  Calendario,
  ContatoRepository,
  ConversaRepository,
  DirecaoMensagem,
  EventStore,
  Fila,
  ItemFila,
  MensagemLog,
  MensagemRepo,
  TipoMensagemLog,
} from '../ports';
import type {
  Contato,
  Conversa,
  PreferenciaVisita,
  Slots,
  StatusContato,
} from '../domain/types';
import { filtrarPreferencia, slotsCandidatos } from '../domain/visita';

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
    // Duas queries em vez de `.or(...)` com valor interpolado: o nome vem da NLU
    // (texto da cliente) e, dentro da string do filtro PostgREST, "," e "()"
    // permitiam injetar condições novas; "%"/"_" viravam curinga do ilike (um
    // "%" casaria QUALQUER contato fechado e derrubaria a conversa em handoff).
    if (nome) {
      const nomeLimpo = nome.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (nomeLimpo) {
        const { data } = await this.db
          .from('contatos')
          .select('telefone, nome, status, data_evento')
          .ilike('nome', nomeLimpo)
          .limit(1)
          .maybeSingle();
        if (data) return mapContato(data);
      }
    }
    if (dataEvento) {
      const { data } = await this.db
        .from('contatos')
        .select('telefone, nome, status, data_evento')
        .eq('data_evento', dataEvento)
        .limit(1)
        .maybeSingle();
      if (data) return mapContato(data);
    }
    return null;
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

  async historico(telefone: string, limite: number): Promise<MensagemLog[]> {
    // Pega as últimas `limite` (ordem desc pelo índice) e devolve cronológico.
    const { data, error } = await this.db
      .from('mensagens')
      .select('direcao, tipo, conteudo, criado_em')
      .eq('telefone', telefone)
      .order('criado_em', { ascending: false })
      .limit(limite);
    // Best-effort: o histórico é contexto, não pode derrubar o turno.
    if (error || !data) return [];
    return data
      .map((m) => ({
        direcao: m.direcao as DirecaoMensagem,
        tipo: m.tipo as TipoMensagemLog,
        conteudo: (m.conteudo as string | null) ?? '',
        criadoEm: m.criado_em as string,
      }))
      .reverse();
  }

  async limpar(telefone: string): Promise<void> {
    // Best-effort: usado pelo #reset de teste; uma falha aqui não derruba o turno.
    await this.db.from('mensagens').delete().eq('telefone', telefone);
  }
}

export class SupabaseEventStore implements EventStore {
  constructor(private readonly db: SupabaseClient) {}

  async marcar(messageId: string): Promise<boolean> {
    const { error } = await this.db.from('eventos_processados').insert({ message_id: messageId });
    if (!error) return true; // inserção nova: primeira vez que vemos essa mensagem
    // 23505 = unique_violation no Postgres: outra chamada (reentrega concorrente
    // da Meta) já inseriu esse message_id primeiro. Isso É a proteção, não um
    // erro — antes esse `error` era ignorado e a mensagem seguia pro processamento
    // mesmo já tendo sido reivindicada, sob concorrência real (duas chamadas de
    // fato simultâneas, não sequenciais) enfileirava a mesma mensagem 2x.
    if (error.code === '23505') return false;
    throw new Error(`marcar evento: ${error.message}`);
  }

  async desmarcar(messageId: string): Promise<void> {
    // Compensação: solta a marca quando a mensagem não chegou a ser enfileirada,
    // para a reentrega da Meta não ser descartada pelo dedup.
    const { error } = await this.db
      .from('eventos_processados')
      .delete()
      .eq('message_id', messageId);
    if (error) throw new Error(`desmarcar evento: ${error.message}`);
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
      mensagem_id: item.mensagemId ?? null,
    });
    if (error) throw new Error(`enfileirar: ${error.message}`);
  }

  async pegarVencidas(agoraISO: string, _limite: number): Promise<ItemFila[]> {
    // Reivindicação ATÔMICA: o UPDATE marca processado_em no mesmo comando que
    // seleciona (WHERE processado_em IS NULL). Se dois consumidores rodam ao
    // mesmo tempo (cron sobreposto, ou cron + chamada manual), cada linha é
    // reivindicada por apenas um — evita processar/responder o mesmo item 2x.
    // `_limite` é IGNORADO de propósito: supabase-js não limita UPDATE, e
    // limitar depois de reivindicar perderia os itens excedentes (já marcados
    // como processados sem nunca serem atendidos). No volume atual o lote é
    // pequeno; se crescer, trocar por RPC com `LIMIT ... FOR UPDATE SKIP LOCKED`.
    const { data, error } = await this.db
      .from('fila_mensagens')
      .update({ processado_em: new Date().toISOString() })
      .is('processado_em', null)
      .lte('processar_apos', agoraISO)
      .select('id, telefone, tipo, conteudo, processar_apos, mensagem_id, criado_em');
    if (error) throw new Error(`pegarVencidas: ${error.message}`);
    // UPDATE ... RETURNING não tem ordem garantida no Postgres: ordena pela
    // chegada (criado_em), senão uma rajada ("Boa tarde" + "150 convidados")
    // podia ser lida fora de ordem pelo NLU.
    const ordenadas = [...(data ?? [])].sort((a, b) =>
      String(a.criado_em).localeCompare(String(b.criado_em)),
    );
    return ordenadas.map((r) => ({
      id: String(r.id),
      telefone: String(r.telefone),
      tipo: r.tipo === 'audio' ? 'audio' : r.tipo === 'outro' ? 'outro' : 'texto',
      conteudo: String(r.conteudo ?? ''),
      processarApos: String(r.processar_apos),
      ...(r.mensagem_id ? { mensagemId: String(r.mensagem_id) } : {}),
    }));
  }

  async marcarProcessado(id: string): Promise<void> {
    await this.db
      .from('fila_mensagens')
      .update({ processado_em: new Date().toISOString() })
      .eq('id', id);
  }

  async contarRecentes(telefone: string, desdeISO: string): Promise<number> {
    const { count, error } = await this.db
      .from('fila_mensagens')
      .select('id', { count: 'exact', head: true })
      .eq('telefone', telefone)
      .gte('criado_em', desdeISO);
    if (error) throw new Error(`contarRecentes: ${error.message}`);
    return count ?? 0;
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

/**
 * Agenda de visita (ADR-0005). Disponibilidade = janelas de visita menos os
 * horários já marcados na tabela `visitas`. Fonte trocável por Google/Apple depois.
 */
export class SupabaseAgendaVisita implements AgendaVisita {
  constructor(private readonly db: SupabaseClient) {}

  async slotsLivres(opts: {
    aPartirDeISO: string;
    preferencia?: PreferenciaVisita;
    limite: number;
  }): Promise<string[]> {
    const ocupados = await this.ocupados(opts.aPartirDeISO);
    const candidatos = slotsCandidatos(opts.aPartirDeISO);
    const livres = candidatos.filter((s) => !ocupados.has(s));

    const naPreferencia = filtrarPreferencia(livres, opts.preferencia);
    // Preferência sem vaga no horizonte: cai para os próximos horários livres.
    const base = naPreferencia.length > 0 ? naPreferencia : livres;
    return base.slice(0, opts.limite);
  }

  async marcar(slotISO: string, telefone: string, nome?: string): Promise<void> {
    // upsert por `inicio` (unique): idempotente se a mesma confirmação repetir.
    const { error } = await this.db
      .from('visitas')
      .upsert({ inicio: slotISO, telefone, nome: nome ?? null }, { onConflict: 'inicio' });
    if (error) throw new Error(`falha ao marcar visita: ${error.message}`);
  }

  private async ocupados(aPartirDeISO: string): Promise<Set<string>> {
    const { data } = await this.db
      .from('visitas')
      .select('inicio')
      .gte('inicio', aPartirDeISO);
    return new Set((data ?? []).map((r) => String((r as { inicio: string }).inicio)));
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
