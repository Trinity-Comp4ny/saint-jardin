// Bateria de usabilidade LOCAL: código real + Gemini real (NLU e Redator), repositórios em
// memória, sem WhatsApp nem Telegram. Mesmo código que roda em produção.
//   set -a; . ./.env; set +a
//   npm run usabilidade            # todos os cenários
//   npm run usabilidade -- B       # só os que começam com B
// Resultado em tools/usabilidade/saida/local-resultados.json (npm run usabilidade:ver).
import { mkdirSync, writeFileSync } from 'node:fs';
import { GeminiNLU } from '../../src/adapters/GeminiNLU';
import { GeminiRedator } from '../../src/adapters/GeminiRedator';
import {
  InMemoryContatoRepo, InMemoryConversaRepo, InMemoryMensagemRepo, MockCalendario,
  RecordingNotifier, SandboxProvider,
} from '../../src/adapters/memory';
import { processarMensagem, type Deps } from '../../src/app/orchestrator';
import { MSG } from '../../src/domain/persona';
import { CENARIOS, type Cenario } from './cenarios';

const AGORA = '2026-10-15T15:00:00.000Z';
const key = process.env.GEMINI_API_KEY!;

export function rotular(s: { tipo: string; texto?: string; pdf?: string; video?: string }): string {
  if (s.tipo === 'video') return '[VÍDEO]';
  if (s.tipo === 'pdf') return `[PDF ${s.pdf}]`;
  const t = s.texto ?? '';
  if (t === MSG.abertura) return '[ABERTURA c/ saudação]';
  if (t === MSG.aberturaSemSaudacao) return '[ABERTURA sem saudação]';
  if (t === MSG.perguntaQualificadora) return '[QUALIFICADORA literal]';
  if (t === MSG.comoPosso) return '[COMO POSSO AJUDAR]';
  if (t === MSG.followUp) return '[FOLLOW-UP]';
  if (t === MSG.perguntaPreferenciaVisita) return '[PERGUNTA DE VISITA]';
  if (t === MSG.ofertaMini) return '[OFERTA MINI]';
  if (t === MSG.ofertaTradicional) return '[OFERTA TRADICIONAL]';
  if (t === MSG.miniInformacoes) return '[MINI c/ informações]';
  if (t === MSG.orcamentoMiniAnuncio) return '[MINI anúncio]';
  if (/^Vou te enviar nossa proposta para casamentos em (\d{4})/.test(t)) return `[PROPOSTA ano ${t.match(/em (\d{4})/)![1]}]`;
  return t.replace(/\n/g, ' / ');
}

async function rodar(c: Cenario): Promise<Record<string, unknown>> {
  const tel = `55119${c.id.replace(/\D/g, '').padStart(2, '0')}${Math.floor(Math.random() * 90000 + 10000)}`;
  const messaging = new SandboxProvider();
  const notifier = new RecordingNotifier();
  const conversas = new InMemoryConversaRepo();
  const deps: Deps = {
    contatos: new InMemoryContatoRepo([{ telefone: '5511999990000', nome: 'Bruna Torelli', status: 'fechado', dataEvento: '21/08' }]),
    conversas,
    nlu: new GeminiNLU(key),
    redator: new GeminiRedator(key),
    calendario: new MockCalendario(new Set(['2027-10-09'])),
    messaging, notifier, mensagens: new InMemoryMensagemRepo(),
    agora: () => AGORA,
  };
  for (const p of c.pre ?? []) {
    if (p === '@followup') {
      const cv = (await conversas.obter(tel))!;
      await conversas.salvar({ ...cv, followupEnviadoEm: AGORA });
    } else await processarMensagem(tel, p, deps);
  }
  const turnos: unknown[] = [];
  for (const t of c.turnos) {
    const antes = messaging.enviadas.length;
    let erro: string | undefined;
    let r;
    try { r = await processarMensagem(tel, t, deps); } catch (e) { erro = String(e); }
    const saidas = messaging.enviadas.slice(antes).flatMap((e) => e.saidas).map(rotular);
    const cv = await conversas.obter(tel);
    turnos.push({ entrada: t.length > 300 ? t.slice(0, 80) + `…(${t.length} chars)` : t, saidas, estado: cv?.estado, slots: cv?.slots, motivo: cv?.motivoHandoff, erro });
  }
  return { id: c.id, grupo: c.grupo, titulo: c.titulo, turnos, alertas: notifier.alertas.map((a) => a.motivo) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const filtro = process.argv[2];
  const lista = CENARIOS.filter((c) => !filtro || c.id.startsWith(filtro));
  const resultados: Record<string, unknown>[] = [];
  const fila = [...lista];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (fila.length) { const c = fila.shift()!; resultados.push(await rodar(c)); }
  }));
  resultados.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  mkdirSync(new URL('./saida/', import.meta.url), { recursive: true });
  writeFileSync(new URL('./saida/local-resultados.json', import.meta.url), JSON.stringify(resultados, null, 2));
  console.log(`${resultados.length} cenários rodados`);
}
