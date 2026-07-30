// Agenda de visita no Google Calendar (ADR-0005, opção C).
// Lê disponibilidade (freeBusy) e escreve o evento (events.insert) via API, com
// autenticação por service account (JWT). Fonte única de verdade = o calendário
// dedicado de visita no Google. Trocável pela porta AgendaVisita, sem tocar no núcleo.

import { JWT } from 'google-auth-library';
import type { AgendaVisita } from '../ports';
import type { PreferenciaVisita } from '../domain/types';
import {
  HORIZONTE_VISITA_DIAS,
  filtrarPreferencia,
  slotsCandidatos,
} from '../domain/visita';

/** Duração de cada visita, em minutos (bloco ofertado). */
const DURACAO_VISITA_MIN = 60;
// Brasil não tem horário de verão desde 2019: offset fixo -03:00.
const OFFSET_BR = '-03:00';
const TZ_BR = 'America/Sao_Paulo';
const API = 'https://www.googleapis.com/calendar/v3';

export interface Ocupado {
  start: string;
  end: string;
}

/** Slot "YYYY-MM-DDTHH:mm" colide com algum intervalo ocupado? (puro, testável) */
export function slotOcupado(slotISO: string, duracaoMin: number, busy: Ocupado[]): boolean {
  const inicio = new Date(`${slotISO}:00${OFFSET_BR}`).getTime();
  const fim = inicio + duracaoMin * 60_000;
  return busy.some((b) => {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    return inicio < be && bs < fim; // sobreposição de intervalos
  });
}

/** ID de evento determinístico por slot (base32hex: 0-9a-v) → marcar é idempotente. */
function idDoSlot(slotISO: string): string {
  return `visita${slotISO.replace(/[^0-9t]/gi, '').toLowerCase()}`;
}

export interface GoogleAgendaConfig {
  clientEmail: string;
  privateKey: string;
  calendarId: string;
}

export class GoogleAgendaVisita implements AgendaVisita {
  private readonly jwt: JWT;
  private readonly calendarId: string;

  constructor(cfg: GoogleAgendaConfig) {
    this.calendarId = cfg.calendarId;
    this.jwt = new JWT({
      email: cfg.clientEmail,
      key: cfg.privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
  }

  async slotsLivres(opts: {
    aPartirDeISO: string;
    preferencia?: PreferenciaVisita;
    limite: number;
  }): Promise<string[]> {
    const candidatos = slotsCandidatos(opts.aPartirDeISO);
    const busy = await this.freebusy(opts.aPartirDeISO);
    const livres = candidatos.filter((s) => !slotOcupado(s, DURACAO_VISITA_MIN, busy));

    const naPreferencia = filtrarPreferencia(livres, opts.preferencia);
    const base = naPreferencia.length > 0 ? naPreferencia : livres;
    return base.slice(0, opts.limite);
  }

  async marcar(slotISO: string, telefone: string, nome?: string): Promise<void> {
    const inicio = new Date(`${slotISO}:00${OFFSET_BR}`);
    const fim = new Date(inicio.getTime() + DURACAO_VISITA_MIN * 60_000);
    const resp = await this.fetch(`/calendars/${encodeURIComponent(this.calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify({
        id: idDoSlot(slotISO),
        summary: `Visita${nome ? ` ${nome}` : ''} (${telefone})`,
        description: `Agendada pela Raquel (bot). Contato: ${telefone}`,
        start: { dateTime: inicio.toISOString(), timeZone: TZ_BR },
        end: { dateTime: fim.toISOString(), timeZone: TZ_BR },
      }),
    });
    // 409 = evento com esse id já existe (mesma confirmação reenviada): idempotente.
    if (!resp.ok && resp.status !== 409) {
      throw new Error(`marcar visita no Google: ${resp.status} ${await resp.text()}`);
    }
  }

  private async freebusy(aPartirDeISO: string): Promise<Ocupado[]> {
    const timeMin = new Date(`${aPartirDeISO.slice(0, 16)}:00${OFFSET_BR}`);
    const timeMax = new Date(timeMin.getTime() + (HORIZONTE_VISITA_DIAS + 1) * 86_400_000);
    const resp = await this.fetch('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: this.calendarId }],
      }),
    });
    if (!resp.ok) {
      throw new Error(`freeBusy do Google: ${resp.status} ${await resp.text()}`);
    }
    const json = (await resp.json()) as {
      calendars?: Record<string, { busy?: Ocupado[] }>;
    };
    return json.calendars?.[this.calendarId]?.busy ?? [];
  }

  private async fetch(path: string, init: RequestInit): Promise<Response> {
    const { token } = await this.jwt.getAccessToken();
    if (!token) throw new Error('Google: sem access token (service account inválida?)');
    return fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }
}
