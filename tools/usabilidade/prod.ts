// Bateria de usabilidade em PRODUÇÃO: posta no webhook real (assinado) como se fosse a Meta,
// de um número de teste. O bot processa (síncrono em MODO_TESTE) e RESPONDE DE VERDADE no
// WhatsApp desse número, e cenários de handoff disparam alerta no Telegram da Raquel.
//
//   set -a; . ./.env; set +a
//   CONFIRMO_PRODUCAO=sim NUMERO_TESTE=<número completo, de NUMEROS_TESTE> \
//     npx tsx tools/usabilidade/prod.ts '[{"id":"B02","seed":"qualificacao"},{"id":"A02"}]'
//
// `seed` (qualificacao | proposta | followup) pula a abertura e o vídeo de 15 MB.
// O #reset não funciona se a conversa estiver em handoff E o número não estiver em
// NUMEROS_TESTE; o executor semeia o estado à força.
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CENARIOS } from './cenarios';
import { rotular } from './local';

if (process.env.CONFIRMO_PRODUCAO !== 'sim') {
  console.error('Isto envia mensagens reais em produção. Defina CONFIRMO_PRODUCAO=sim para continuar.');
  process.exit(1);
}
const URL_BASE = process.env.URL_BASE ?? 'https://saint-jardin.vercel.app';
const SB = process.env.SUPABASE_URL!;
const H = { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, 'Content-Type': 'application/json' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers as object) } });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

const TEL = process.env.NUMERO_TESTE;
if (!TEL || !(process.env.NUMEROS_TESTE ?? '').split(',').map((n) => n.trim()).includes(TEL)) {
  console.error('NUMERO_TESTE precisa ser um dos números de NUMEROS_TESTE.');
  process.exit(1);
}

async function limparFila() { await fetch(`${SB}/rest/v1/fila_mensagens?telefone=eq.${TEL}`, { method: 'DELETE', headers: H }); }

async function enviar(texto: string): Promise<number> {
  await limparFila(); // o rate limit (30/h por número) travaria uma bateria longa
  const corpo = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'pentest', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp', metadata: { phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID },
      contacts: [{ profile: { name: 'Teste' }, wa_id: TEL }],
      messages: [{ from: TEL, id: `wamid.PENTEST${Date.now()}${Math.floor(Math.random() * 1e6)}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }],
    } }] }],
  });
  const assinatura = 'sha256=' + createHmac('sha256', process.env.WHATSAPP_APP_SECRET!).update(corpo).digest('hex');
  const r = await fetch(`${URL_BASE}/api/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': assinatura }, body: corpo });
  return r.status;
}

async function semear(seed: string) {
  const agora = new Date().toISOString();
  const base = { ano: 2028, diaSemana: 'sabado', preferenciaDia: 'fim_de_semana', convidados: 150 };
  const estados: Record<string, object> = {
    qualificacao: { estado: 'aguardando_qualificacao', slots: {} },
    proposta: { estado: 'proposta_enviada', slots: base, proposta_enviada_em: agora, ultima_entrada_em: agora, followup_enviado_em: null },
    followup: { estado: 'proposta_enviada', slots: base, proposta_enviada_em: agora, ultima_entrada_em: agora, followup_enviado_em: agora },
  };
  await sb(`conversas?telefone=eq.${TEL}`, { method: 'PATCH', body: JSON.stringify({ motivo_handoff: null, ...estados[seed] }) });
}

async function saidasDesde(t0: string) {
  const rows = await sb(`mensagens?select=direcao,tipo,conteudo,criado_em&telefone=eq.${TEL}&arquivada=eq.false&criado_em=gt.${encodeURIComponent(t0)}&order=criado_em.asc`);
  return rows.filter((m: { direcao: string }) => m.direcao === 'saida').map((m: { tipo: string; conteudo: string }) =>
    rotular(m.tipo === 'pdf' ? { tipo: 'pdf', pdf: m.conteudo } : m.tipo === 'video' ? { tipo: 'video', video: m.conteudo } : { tipo: 'texto', texto: m.conteudo }));
}

// Quais cenários e como começam (seed pula a abertura e o vídeo de 15 MB).
const PLANO: { id: string; seed?: string }[] = JSON.parse(process.argv[2] ?? '[]');
const resultados: unknown[] = [];
for (const p of PLANO) {
  const c = CENARIOS.find((x) => x.id === p.id)!;
  await enviar('#reset'); await sleep(1500);
  if (p.seed) await semear(p.seed);
  const turnos: unknown[] = [];
  for (const t of c.turnos) {
    const t0 = new Date(Date.now() - 1500).toISOString();
    const status = await enviar(t);
    await sleep(1200);
    const saidas = await saidasDesde(t0);
    const cv = (await sb(`conversas?select=estado,slots,motivo_handoff&telefone=eq.${TEL}`))[0];
    turnos.push({ entrada: t.length > 300 ? t.slice(0, 80) + `…(${t.length})` : t, http: status, saidas, estado: cv?.estado, slots: cv?.slots, motivo: cv?.motivo_handoff });
  }
  resultados.push({ id: c.id, grupo: c.grupo, titulo: c.titulo + (p.seed ? ` [início: ${p.seed}]` : ''), turnos, alertas: [] });
  console.error(`✓ ${c.id}`);
}
mkdirSync(new URL('./saida/', import.meta.url), { recursive: true });
writeFileSync(new URL('./saida/prod-resultados.json', import.meta.url), JSON.stringify(resultados, null, 2));
