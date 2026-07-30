// Simulador de conversas: roda uma bateria grande de cenários pelo NLU REAL
// (Gemini) + orchestrator + máquina de estados, 100% em memória (sem WhatsApp,
// Telegram nem Supabase). Detecta anomalias (silêncio, repetição, estado
// inesperado) e imprime um relatório. Uso:
//
//   npx tsx src/sandbox/simular.ts
//
// Precisa de GEMINI_API_KEY (lido do .env abaixo).

import { readFileSync } from 'node:fs';
import { stdout, stderr } from 'node:process';

// Mini-loader de .env (sem depender de dotenv), antes de instanciar o NLU.
for (const linha of readFileSync('.env', 'utf8').split('\n')) {
  const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && m[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
}

import { GeminiNLU } from '../adapters/GeminiNLU';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../adapters/memory';
import { processarMensagem, type Deps } from '../app/orchestrator';
import type { Contato, EntradaNLU, MensagemSaida } from '../domain/types';
import type { NLU } from '../ports';
import type { Conversa } from '../domain/types';

function out(linha: string): void {
  stdout.write(linha + '\n');
}

// NLU espião: delega ao real e guarda o que o modelo entendeu, para o relatório.
class NLUEspiao implements NLU {
  public analises: EntradaNLU[] = [];
  constructor(private readonly real: NLU) {}
  async analisar(texto: string, conversa: Conversa): Promise<EntradaNLU> {
    const r = await this.real.analisar(texto, conversa);
    this.analises.push(r);
    return r;
  }
}

interface Cenario {
  nome: string;
  categoria: string;
  mensagens: string[];
  contatos?: Contato[];
  estadoFinalEsperado?: string;
  motivoHandoffInclui?: string;
  algumaSaidaInclui?: string; // alguma saída do bot deve conter este texto
}

interface Turno {
  usuario: string;
  intencao: string;
  afirmativo?: boolean;
  slots: Record<string, unknown>;
  visita?: Record<string, unknown>;
  estado: string;
  saidas: string[];
  flags: string[];
}

interface ResultadoCenario {
  cenario: Cenario;
  turnos: Turno[];
  estadoFinal: string;
  motivoHandoff?: string;
  problemas: string[];
}

const gemini = new GeminiNLU();

function resumoSaidas(saidas: MensagemSaida[]): string[] {
  return saidas.map((s) => (s.tipo === 'pdf' ? `[PDF ${s.pdf}]` : (s.texto ?? '')));
}

async function simular(cenario: Cenario): Promise<ResultadoCenario> {
  const telefone = `sim-${Math.random().toString(36).slice(2, 9)}`;
  const espiao = new NLUEspiao(gemini);
  const provider = new SandboxProvider();
  const notifier = new RecordingNotifier();
  const conversas = new InMemoryConversaRepo();
  const deps: Deps = {
    contatos: new InMemoryContatoRepo(cenario.contatos ?? []),
    conversas,
    nlu: espiao,
    calendario: new MockCalendario(),
    messaging: provider,
    notifier,
    agora: () => new Date().toISOString(),
  };

  const turnos: Turno[] = [];
  let saidaTextoAnterior = '';

  for (const msg of cenario.mensagens) {
    const antes = provider.enviadas.length;
    const { conversa } = await processarMensagem(telefone, msg, deps);
    const novas = provider.enviadas.slice(antes).flatMap((e) => e.saidas);
    const saidas = resumoSaidas(novas);
    const analise = espiao.analises.at(-1);
    const flags: string[] = [];

    const soTexto = novas.filter((s) => s.tipo !== 'pdf').map((s) => s.texto ?? '');
    // Silêncio inesperado: nada respondido e não é handoff/humano.
    if (novas.length === 0 && conversa.estado !== 'handoff' && conversa.estado !== 'humano') {
      flags.push('SILENCIO');
    }
    // Repetição robótica: texto idêntico ao do turno anterior.
    for (const t of soTexto) {
      if (t && t === saidaTextoAnterior) flags.push('REPETICAO');
    }
    if (soTexto.length > 0) saidaTextoAnterior = soTexto[soTexto.length - 1] ?? saidaTextoAnterior;

    turnos.push({
      usuario: msg,
      intencao: analise?.intencao ?? '?',
      afirmativo: analise?.afirmativo,
      slots: (analise?.slots ?? {}) as Record<string, unknown>,
      visita: analise?.visita as Record<string, unknown> | undefined,
      estado: conversa.estado,
      saidas,
      flags,
    });
  }

  const ultima = await conversas.obter(telefone);
  const estadoFinal = ultima?.estado ?? '?';
  const motivoHandoff = ultima?.motivoHandoff;

  const problemas: string[] = [];
  for (const t of turnos) for (const f of t.flags) problemas.push(`${f} em "${t.usuario}"`);
  if (cenario.estadoFinalEsperado && estadoFinal !== cenario.estadoFinalEsperado) {
    problemas.push(`estado final ${estadoFinal} != esperado ${cenario.estadoFinalEsperado}`);
  }
  if (cenario.motivoHandoffInclui) {
    if (!motivoHandoff || !motivoHandoff.toLowerCase().includes(cenario.motivoHandoffInclui.toLowerCase())) {
      problemas.push(`motivo handoff "${motivoHandoff ?? '—'}" não inclui "${cenario.motivoHandoffInclui}"`);
    }
  }
  if (cenario.algumaSaidaInclui) {
    const todas = turnos.flatMap((t) => t.saidas).join(' | ').toLowerCase();
    if (!todas.includes(cenario.algumaSaidaInclui.toLowerCase())) {
      problemas.push(`nenhuma saída inclui "${cenario.algumaSaidaInclui}"`);
    }
  }

  return { cenario, turnos, estadoFinal, motivoHandoff, problemas };
}

// Executa com concorrência limitada (respeita rate limit do Gemini).
async function comPool<T, R>(itens: T[], limite: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(itens.length);
  let i = 0;
  async function worker(): Promise<void> {
    while (i < itens.length) {
      const idx = i++;
      resultados[idx] = await fn(itens[idx] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, worker));
  return resultados;
}

function fmtSlots(s: Record<string, unknown>): string {
  const e = Object.entries(s).filter(([, v]) => v !== undefined && v !== null);
  return e.length ? e.map(([k, v]) => `${k}=${v}`).join(',') : '—';
}

function imprimir(res: ResultadoCenario[]): void {
  const linhas: string[] = [];
  let comProblema = 0;
  for (const r of res) {
    const marca = r.problemas.length ? '⚠️ ' : '✓ ';
    linhas.push(`\n${marca}[${r.cenario.categoria}] ${r.cenario.nome}  (final: ${r.estadoFinal})`);
    for (const t of r.turnos) {
      const vis = t.visita ? ` visita=${fmtSlots(t.visita)}` : '';
      const fl = t.flags.length ? `  <<${t.flags.join(',')}>>` : '';
      linhas.push(`   👤 ${t.usuario}`);
      linhas.push(`      nlu: intencao=${t.intencao}${t.afirmativo ? ' afirm' : ''} slots=${fmtSlots(t.slots)}${vis} -> ${t.estado}${fl}`);
      for (const s of t.saidas) linhas.push(`      🤖 ${s.replace(/\n/g, ' / ')}`);
    }
    if (r.problemas.length) {
      comProblema++;
      for (const p of r.problemas) linhas.push(`   ⚠️  ${p}`);
    }
  }
  linhas.push(`\n${'='.repeat(60)}`);
  linhas.push(`Total: ${res.length} cenários | com problema/atenção: ${comProblema}`);
  out(linhas.join('\n'));
}

const CLIENTE_FECHADO: Contato[] = [
  { telefone: 'sim-x', nome: 'Mariana Alves', status: 'fechado', dataEvento: '2027-05-15' },
];

const CENARIOS: Cenario[] = [
  // ── Saudações e aberturas ────────────────────────────────────────────
  { nome: 'oi seco', categoria: 'saudação', mensagens: ['oi'], estadoFinalEsperado: 'aguardando_qualificacao' },
  { nome: 'bom dia educado', categoria: 'saudação', mensagens: ['Bom dia! Tudo bem?'], estadoFinalEsperado: 'aguardando_qualificacao' },
  { nome: 'oi + saudação depois', categoria: 'saudação', mensagens: ['Olá', 'Bom dia, tudo bem?'] },
  { nome: 'quero informações', categoria: 'saudação', mensagens: ['Oi, gostaria de informações sobre o espaço'] },

  // ── Qualificação ─────────────────────────────────────────────────────
  { nome: 'tudo numa msg (sábado 150 2027)', categoria: 'qualificação', mensagens: ['Oi! Quero casar num sábado, uns 150 convidados, em 2027'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'dados em partes', categoria: 'qualificação', mensagens: ['oi', 'vai ser num sábado', 'uns 120 convidados', '2028'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'só o dia primeiro', categoria: 'qualificação', mensagens: ['oi', 'sábado'] },
  { nome: 'pergunta preço direto', categoria: 'qualificação', mensagens: ['Oi, quanto custa pra alugar?'] },
  { nome: 'preço antes de dados', categoria: 'qualificação', mensagens: ['quanto fica um casamento pra 200 pessoas?'] },

  // ── Data ─────────────────────────────────────────────────────────────
  { nome: 'data só dia/mês', categoria: 'data', mensagens: ['oi', 'sábado, 100 pessoas', '20 de março'], algumaSaidaInclui: 'ano' },
  { nome: 'data completa com ano', categoria: 'data', mensagens: ['oi', 'sábado, 100 pessoas', '20 de março de 2028'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'ano 2 dígitos', categoria: 'data', mensagens: ['oi', 'sábado, 100 pessoas', 'que ano? 28'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'data por extenso confusa', categoria: 'data', mensagens: ['oi', 'quero um sábado pra 90 pessoas', 'pode ser dia 5 do 12 de 2027'], estadoFinalEsperado: 'proposta_enviada' },

  // ── Mini wedding vs normal ───────────────────────────────────────────
  { nome: 'mini wedding (quarta, 50)', categoria: 'mini', mensagens: ['oi', 'queria num dia de semana, uns 50 convidados'], estadoFinalEsperado: 'aguardando_interesse_mini' },
  { nome: 'mini aceita', categoria: 'mini', mensagens: ['oi', 'dia de semana, 40 pessoas', 'sim, quero receber'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'dia de semana >80 (explica)', categoria: 'mini', mensagens: ['oi', 'quero dia de semana pra 200 pessoas'], estadoFinalEsperado: 'aguardando_confirmacao_normal' },
  { nome: 'dia semana >80 depois confirma', categoria: 'mini', mensagens: ['oi', 'terça, 150 convidados', 'sim pode mandar', '2027'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'dia semana >80 reduz p/ mini', categoria: 'mini', mensagens: ['oi', 'quarta-feira, 200 pessoas', 'na verdade uns 60'], estadoFinalEsperado: 'aguardando_interesse_mini' },
  { nome: 'quinta 80 (limite exato)', categoria: 'mini', mensagens: ['oi', 'quinta-feira, exatamente 80 convidados'], estadoFinalEsperado: 'aguardando_interesse_mini' },
  { nome: 'quinta 81 (acima do limite)', categoria: 'mini', mensagens: ['oi', 'quinta, 81 convidados'], estadoFinalEsperado: 'aguardando_confirmacao_normal' },

  // ── Negociação / handoff ─────────────────────────────────────────────
  { nome: 'negociar valor', categoria: 'handoff', mensagens: ['oi', 'quero negociar o valor'], estadoFinalEsperado: 'handoff', motivoHandoffInclui: 'negociar' },
  { nome: 'pede desconto', categoria: 'handoff', mensagens: ['oi', 'sábado 150 2027', 'consegue um desconto?'], estadoFinalEsperado: 'handoff' },
  { nome: 'parcelamento', categoria: 'handoff', mensagens: ['oi', 'dá pra parcelar em quantas vezes?'] },

  // ── Visita de noiva ──────────────────────────────────────────────────
  { nome: 'aceita visita + preferência', categoria: 'visita-noiva', mensagens: ['oi', 'sábado, 150, 2027', 'vamos sim!', 'pode ser sábado de manhã'], estadoFinalEsperado: 'handoff', motivoHandoffInclui: 'visita da noiva' },
  { nome: 'aceita visita tanto faz', categoria: 'visita-noiva', mensagens: ['oi', 'sábado, 150, 2027', 'quero conhecer sim', 'qualquer dia pra mim'], estadoFinalEsperado: 'handoff' },
  { nome: 'quer marcar visita direto', categoria: 'visita-noiva', mensagens: ['oi', 'sábado, 150, 2027', 'posso agendar uma visita?'] },

  // ── Visita técnica ───────────────────────────────────────────────────
  { nome: 'técnica sem data', categoria: 'visita-tecnica', mensagens: ['Oi, sou do buffet de um casamento que já fechou, queria fazer uma visita técnica'], estadoFinalEsperado: 'visita_tecnica_data', algumaSaidaInclui: 'terça a sexta' },
  { nome: 'técnica data válida (16/09)', categoria: 'visita-tecnica', mensagens: ['Quero agendar uma visita técnica para 16 de setembro de 2026'], estadoFinalEsperado: 'handoff', motivoHandoffInclui: 'visita técnica' },
  { nome: 'técnica fim de semana', categoria: 'visita-tecnica', mensagens: ['Preciso de uma visita técnica dia 19 de setembro de 2026'], estadoFinalEsperado: 'visita_tecnica_data' },
  { nome: 'técnica muito próxima', categoria: 'visita-tecnica', mensagens: ['Sou decoradora, queria visita técnica para 5 de agosto de 2026'], estadoFinalEsperado: 'visita_tecnica_data' },
  { nome: 'técnica corrige p/ data válida', categoria: 'visita-tecnica', mensagens: ['visita técnica dia 19 de setembro de 2026', 'então dia 23 de setembro de 2026'], estadoFinalEsperado: 'handoff' },

  // ── Cliente já fechado ───────────────────────────────────────────────
  { nome: 'diz que já fechou', categoria: 'cliente-fechado', mensagens: ['Oi, eu já fechei meu casamento com vocês, queria tirar uma dúvida'], estadoFinalEsperado: 'handoff' },
  { nome: 'cliente fechado por nome', categoria: 'cliente-fechado', mensagens: ['Oi, aqui é a Mariana Alves, já sou cliente de vocês'], contatos: CLIENTE_FECHADO, estadoFinalEsperado: 'handoff' },

  // ── Fora do script ───────────────────────────────────────────────────
  { nome: 'tem buffet?', categoria: 'fora-script', mensagens: ['oi', 'vocês fornecem o buffet?'] },
  { nome: 'aceita pet?', categoria: 'fora-script', mensagens: ['oi', 'posso levar meu cachorro no casamento?'] },
  { nome: 'estacionamento', categoria: 'fora-script', mensagens: ['oi', 'tem estacionamento para os convidados?'] },
  { nome: 'onde fica', categoria: 'fora-script', mensagens: ['oi', 'qual o endereço de vocês?'] },

  // ── Linguagem informal / typos / áudio-like ──────────────────────────
  { nome: 'typos e abreviações', categoria: 'linguagem', mensagens: ['oi bom dia', 'qro sbr vlr pra uns 100 convidado num sbd de 2027'] },
  { nome: 'áudio transcrito longo', categoria: 'linguagem', mensagens: ['oii tudo bem então é o seguinte eu tô querendo casar acho que ano que vem 2027 num sábado a gente tá pensando em uns 180 convidados mais ou menos você consegue me passar um valor'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'emojis', categoria: 'linguagem', mensagens: ['oi 🥰', 'quero casar 👰 sábado, 130 pessoas, 2028 🎉'], estadoFinalEsperado: 'proposta_enviada' },
  { nome: 'muito curta', categoria: 'linguagem', mensagens: ['casamento', 'sabado', '200', '2027'] },

  // ── Ambíguo / múltiplas intenções ────────────────────────────────────
  { nome: 'preço e visita juntos', categoria: 'ambíguo', mensagens: ['oi', 'quero saber o valor pra 150 pessoas num sábado de 2027 e já marcar uma visita'] },
  { nome: 'muda de ideia no meio', categoria: 'ambíguo', mensagens: ['oi', 'sábado 200 pessoas', 'ah não, melhor domingo', '2027'] },
  { nome: 'responde outra coisa', categoria: 'ambíguo', mensagens: ['oi', 'quanto custa?', 'sábado', 'ah, 150 pessoas', '2027'] },
  { nome: 'sim isolado', categoria: 'ambíguo', mensagens: ['oi', 'sim'] },
  { nome: 'não sei ainda', categoria: 'ambíguo', mensagens: ['oi', 'ainda não sei a data nem quantas pessoas'] },
];

async function main(): Promise<void> {
  const res = await comPool(CENARIOS, 6, simular);
  imprimir(res);
}

main().catch((e) => {
  stderr.write(String(e?.stack ?? e) + '\n');
  process.exit(1);
});
