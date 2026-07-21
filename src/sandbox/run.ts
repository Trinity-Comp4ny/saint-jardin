// Sandbox CLI: roda uma conversa ponta a ponta, 100% em memória, sem WhatsApp
// nem API. Serve para "ver o bot funcionando" antes de qualquer integração.
//
//   npm run sandbox              -> roteiro de demonstração
//   npm run sandbox -- --repl    -> modo interativo (você digita como a noiva)

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { MockNLU } from '../adapters/MockNLU';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../adapters/memory';
import { processarMensagem, type Deps } from '../app/orchestrator';
import { PDF_CATALOGO } from '../domain/pdfs';
import type { MensagemSaida } from '../domain/types';

function out(linha: string): void {
  stdout.write(linha + '\n');
}

function render(saidas: MensagemSaida[]): void {
  for (const s of saidas) {
    if (s.tipo === 'pdf' && s.pdf) {
      out(`   Raquel 📎 [PDF: ${PDF_CATALOGO[s.pdf].arquivo}]`);
    } else {
      out(`   Raquel 💬 ${s.texto}`);
    }
  }
}

function criarDeps(): { deps: Deps; notifier: RecordingNotifier } {
  const notifier = new RecordingNotifier();
  const deps: Deps = {
    contatos: new InMemoryContatoRepo([
      // Exemplo de cliente que JÁ fechou (o bot não deve atender).
      { telefone: '5511999990000', nome: 'Bruna Torelli', status: 'fechado', dataEvento: '21/08' },
    ]),
    conversas: new InMemoryConversaRepo(),
    nlu: new MockNLU(),
    calendario: new MockCalendario(new Set(['2027-10-09'])), // uma data ocupada de exemplo
    messaging: new SandboxProvider(),
    notifier,
    agora: () => new Date().toISOString(),
  };
  return { deps, notifier };
}

async function turno(deps: Deps, telefone: string, texto: string): Promise<void> {
  out(`\n Noiva 👰 ${texto}`);
  const { conversa, saidas } = await processarMensagem(telefone, texto, deps);
  render(saidas);
  if (conversa.estado === 'handoff') {
    out(`   ⚠️  handoff -> Raquel (motivo: ${conversa.motivoHandoff})`);
  }
}

async function roteiroDemo(): Promise<void> {
  const { deps } = criarDeps();
  const noiva = '5511988887777';
  out('===== DEMO: noiva de sábado, 2027, 200 convidados =====');
  await turno(deps, noiva, 'Olá! Tenho interesse e quero solicitar um orçamento');
  await turno(deps, noiva, 'Penso em um sábado');
  await turno(deps, noiva, 'Aproximadamente 200 pessoas, em 2027');
  await turno(deps, noiva, 'Quero sim marcar uma visita');

  const { deps: deps2 } = criarDeps();
  const noiva2 = '5511977776666';
  out('\n===== DEMO: mini wedding (dia de semana) =====');
  await turno(deps2, noiva2, 'Oi, quero um orçamento');
  await turno(deps2, noiva2, 'Seria num dia de semana, umas 50 pessoas');
  await turno(deps2, noiva2, 'Sim, pode mandar!');

  const { deps: deps3, notifier } = criarDeps();
  out('\n===== DEMO: cliente que já fechou =====');
  await turno(deps3, '5511999990000', 'Oi Raquel, preciso tirar uma dúvida do meu contrato');
  out(`   (alertas gerados: ${notifier.alertas.length})`);
}

async function repl(): Promise<void> {
  const { deps } = criarDeps();
  const telefone = '5511900000000';
  const rl = createInterface({ input: stdin, output: stdout });
  out('Modo interativo. Digite como a noiva (Ctrl+C para sair).');
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const texto = await rl.question('\n Noiva 👰 ');
    if (!texto.trim()) continue;
    const { conversa, saidas } = await processarMensagem(telefone, texto, deps);
    render(saidas);
    if (conversa.estado === 'handoff') {
      out(`   ⚠️  handoff -> Raquel (motivo: ${conversa.motivoHandoff})`);
    }
  }
}

const modoRepl = process.argv.includes('--repl');
(modoRepl ? repl() : roteiroDemo()).catch((e) => {
  stdout.write(`erro: ${String(e)}\n`);
  process.exit(1);
});
