// Raiz de composição: monta as dependências reais a partir do ambiente.
// Um único lugar que conhece env + adapters concretos.
//
// Duas fronteiras, dois conjuntos de deps (cada endpoint valida só o que usa):
//   - ingestão (/api/whatsapp): apenas dedup + fila (Supabase).
//   - processamento (/api/process): NLU, calendário, envio, transcrição, handoff.

import { GeminiNLU } from '../adapters/GeminiNLU';
import { GoogleAgendaVisita } from '../adapters/GoogleAgendaVisita';
import { GroqTranscriber, type Transcriber } from '../adapters/GroqTranscriber';
import { TelegramNotifier } from '../adapters/TelegramNotifier';
import { WhatsAppCloudProvider } from '../adapters/WhatsAppCloudProvider';
import {
  SupabaseAgendaVisita,
  SupabaseCalendario,
  SupabaseContatoRepo,
  SupabaseConversaRepo,
  SupabaseEventStore,
  SupabaseFila,
  SupabaseMensagemRepo,
  criarSupabase,
} from '../adapters/supabase';
import { PDF_CATALOGO } from '../domain/pdfs';
import type { TipoPdf } from '../domain/types';
import type { AgendaVisita, EventStore, Fila, Notifier } from '../ports';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deps } from './orchestrator';

function obrigatorio(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}

const BUCKET_PDF = 'propostas';

function criarDb() {
  return criarSupabase(
    obrigatorio('SUPABASE_URL'),
    obrigatorio('SUPABASE_SERVICE_ROLE_KEY'),
  );
}

// Groq (áudio) e Telegram (handoff) são usados só em ramos específicos do fluxo.
// Instanciamos de forma lazy: a env só é exigida quando o recurso é de fato usado,
// não ao montar as deps. Assim texto sem handoff roda sem GROQ/TELEGRAM configurados.
function transcriberLazy(whatsappToken: string): Transcriber {
  let real: Transcriber | null = null;
  return {
    transcrever(mediaId) {
      real ??= new GroqTranscriber({ groqApiKey: obrigatorio('GROQ_API_KEY'), whatsappToken });
      return real.transcrever(mediaId);
    },
  };
}

/**
 * Agenda de visita: Google Calendar quando as três envs existem (ADR-0005 opção C),
 * senão a tabela `visitas` do Supabase. Trocar de fonte = só a env, sem tocar no fluxo.
 * A GOOGLE_PRIVATE_KEY vem com "\n" literais no painel da Vercel; desescapamos aqui.
 */
function criarAgendaVisita(db: SupabaseClient): AgendaVisita {
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (clientEmail && privateKey && calendarId) {
    return new GoogleAgendaVisita({
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
      calendarId,
    });
  }
  return new SupabaseAgendaVisita(db);
}

function notifierLazy(): Notifier {
  let real: Notifier | null = null;
  return {
    alertarHandoff(conversa, motivo) {
      real ??= new TelegramNotifier({
        botToken: obrigatorio('TELEGRAM_BOT_TOKEN'),
        chatId: obrigatorio('TELEGRAM_CHAT_ID'),
      });
      return real.alertarHandoff(conversa, motivo);
    },
  };
}

/** Deps da ingestão do webhook: só dedup + fila. Valida apenas o Supabase. */
export interface IngestAppDeps {
  eventos: EventStore;
  fila: Fila;
}

export function montarIngestDeps(): IngestAppDeps {
  const db = criarDb();
  return {
    eventos: new SupabaseEventStore(db),
    fila: new SupabaseFila(db),
  };
}

/** Deps do processamento: núcleo do agente + transcrição. Valida tudo que usa. */
export interface ProcessAppDeps {
  orquestrador: Deps;
  fila: Fila;
  transcriber: Transcriber;
}

export function montarProcessDeps(): ProcessAppDeps {
  const db = criarDb();
  const whatsappToken = obrigatorio('WHATSAPP_TOKEN');

  const messaging = new WhatsAppCloudProvider({
    phoneNumberId: obrigatorio('WHATSAPP_PHONE_NUMBER_ID'),
    token: whatsappToken,
    resolverPdfUrl: async (tipo: TipoPdf) => {
      const arquivo = PDF_CATALOGO[tipo].arquivo;
      const { data, error } = await db.storage
        .from(BUCKET_PDF)
        .createSignedUrl(arquivo, 60 * 10);
      if (error || !data) throw new Error(`signed url do PDF ${tipo}: ${error?.message}`);
      return data.signedUrl;
    },
  });

  const orquestrador: Deps = {
    contatos: new SupabaseContatoRepo(db),
    conversas: new SupabaseConversaRepo(db),
    nlu: new GeminiNLU(obrigatorio('GEMINI_API_KEY')),
    calendario: new SupabaseCalendario(db),
    agendaVisita: criarAgendaVisita(db),
    messaging,
    notifier: notifierLazy(),
    mensagens: new SupabaseMensagemRepo(db),
    agora: () => new Date().toISOString(),
  };

  return {
    orquestrador,
    fila: new SupabaseFila(db),
    transcriber: transcriberLazy(whatsappToken),
  };
}
