// Raiz de composição: monta as dependências reais a partir do ambiente.
// Um único lugar que conhece env + adapters concretos.
//
// Duas fronteiras, dois conjuntos de deps (cada endpoint valida só o que usa):
//   - ingestão (/api/whatsapp): apenas dedup + fila (Supabase).
//   - processamento (/api/process): NLU, calendário, envio, transcrição, handoff.

import { GeminiNLU } from '../adapters/GeminiNLU';
import { GeminiRedator } from '../adapters/GeminiRedator';
import { GeminiTranscriber } from '../adapters/GeminiTranscriber';
import { TelegramNotifier } from '../adapters/TelegramNotifier';
import { WhatsAppCloudProvider } from '../adapters/WhatsAppCloudProvider';
import {
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
import type { EventStore, Fila, Notifier, Transcriber } from '../ports';
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

// Telegram (handoff) é usado só num ramo específico do fluxo. Instanciamos de
// forma lazy: a env só é exigida quando o recurso é de fato usado, não ao montar
// as deps. Assim uma conversa sem handoff roda sem TELEGRAM configurado.
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
  const geminiApiKey = obrigatorio('GEMINI_API_KEY');

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
    // Deixa o "digitando…" visível por um instante antes da primeira resposta.
    delayInicioMs: 2500,
  });

  // Modo teste: só existe se NUMEROS_TESTE estiver setada. Em produção, deixe a
  // variável ausente e o comando de reset simplesmente não existe.
  const numerosTeste = (process.env.NUMEROS_TESTE ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const orquestrador: Deps = {
    contatos: new SupabaseContatoRepo(db),
    conversas: new SupabaseConversaRepo(db),
    nlu: new GeminiNLU(geminiApiKey),
    redator: new GeminiRedator(geminiApiKey),
    calendario: new SupabaseCalendario(db),
    messaging,
    notifier: notifierLazy(),
    mensagens: new SupabaseMensagemRepo(db),
    agora: () => new Date().toISOString(),
    ...(numerosTeste.length > 0 ? { numerosTeste } : {}),
  };

  return {
    orquestrador,
    fila: new SupabaseFila(db),
    transcriber: new GeminiTranscriber({ geminiApiKey, whatsappToken }),
  };
}
