// Mostra um arquivo de resultados da bateria de usabilidade como conversas legíveis.
//   npm run usabilidade:ver                     # local, todos
//   npm run usabilidade:ver -- local B          # local, só os que começam com B
//   npm run usabilidade:ver -- prod D03         # produção
import { readFileSync } from 'node:fs';

const [origem = 'local', prefixo = ''] = process.argv.slice(2);
const arquivo = new URL(`./saida/${origem}-resultados.json`, import.meta.url);
for (const c of JSON.parse(readFileSync(arquivo, 'utf8'))) {
  if (!c.id.startsWith(prefixo)) continue;
  console.log(`\n## ${c.id} [${c.grupo}] ${c.titulo}`);
  for (const t of c.turnos) {
    console.log(`  👰 ${t.entrada}`);
    if (t.erro) console.log(`  ❌ ERRO: ${t.erro.slice(0, 150)}`);
    for (const s of t.saidas) console.log(`  🤖 ${s.slice(0, 230)}`);
    if (t.saidas.length === 0) console.log('  🤖 (silêncio)');
    const slots = Object.entries(t.slots ?? {}).filter(([k, v]) => v != null && k !== 'dataOcupadaAvisada');
    console.log(`     └ estado=${t.estado} slots=${JSON.stringify(Object.fromEntries(slots))}${t.motivo ? ` motivo=${t.motivo}` : ''}`);
  }
  if (c.alertas?.length) console.log(`  🔔 alertas (simulado): ${JSON.stringify(c.alertas)}`);
}
