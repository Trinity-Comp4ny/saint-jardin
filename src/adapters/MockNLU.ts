// NLU determinística baseada em palavras-chave. Serve para os testes (hermético,
// sem API) e para o sandbox local. Em produção, usar GeminiNLU.

import type { NLU } from '../ports';
import type { Ano, Conversa, DiaSemana, EntradaNLU, Intencao, Slots } from '../domain/types';

const DIAS: Record<string, DiaSemana> = {
  segunda: 'segunda',
  terca: 'terca',
  'terça': 'terca',
  quarta: 'quarta',
  quinta: 'quinta',
  sexta: 'sexta',
  sabado: 'sabado',
  'sábado': 'sabado',
  domingo: 'domingo',
};

const DOW_ISO: DiaSemana[] = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
];

function normalizar(s: string): string {
  return s.toLowerCase();
}

function extrairData(t: string): { data?: string; ano?: Ano; diaSemana?: DiaSemana } {
  const m = t.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return {};
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  let ano: number | undefined = m[3] ? Number(m[3]) : undefined;
  if (ano !== undefined && ano < 100) ano += 2000;
  if (ano === undefined) return {};
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return {};
  const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  const d = new Date(`${iso}T12:00:00`);
  const diaSemana = DOW_ISO[d.getUTCDay()];
  const anoTipado: Ano | undefined = ano === 2027 || ano === 2028 ? (ano as Ano) : undefined;
  return { data: iso, ano: anoTipado, diaSemana };
}

function extrairSlots(t: string): Slots {
  const slots: Slots = {};

  const data = extrairData(t);
  if (data.data) slots.data = data.data;
  if (data.diaSemana) slots.diaSemana = data.diaSemana;

  const anoMatch = t.match(/\b(2027|2028)\b/);
  if (anoMatch) slots.ano = Number(anoMatch[1]) as Ano;
  else if (data.ano) slots.ano = data.ano;

  for (const [chave, dia] of Object.entries(DIAS)) {
    if (t.includes(chave)) {
      slots.diaSemana = dia;
      break;
    }
  }
  if (!slots.diaSemana) {
    if (/dia de semana|durante a semana|meio de semana/.test(t)) {
      slots.preferenciaDia = 'dia_de_semana';
    } else if (/fim de semana|final de semana/.test(t)) {
      slots.preferenciaDia = 'fim_de_semana';
    }
  }

  const convMatch = t.match(/(\d{2,4})\s*(pessoas|convidados|adultos)/);
  if (convMatch) {
    slots.convidados = Number(convMatch[1]);
  } else {
    // número solto plausível de convidados (evita anos)
    const nums = t.match(/\b(\d{2,4})\b/g)?.map(Number) ?? [];
    const candidato = nums.find((n) => n >= 10 && n <= 1500 && n !== 2027 && n !== 2028);
    if (candidato !== undefined) slots.convidados = candidato;
  }

  return slots;
}

function detectarIntencao(t: string): Intencao {
  if (
    /j[áa] fechei|j[áa] fechamos|j[áa] contratei|sou (a )?noiva do dia|meu casamento (é|e|vai ser) (dia|no)|cliente de voc[êe]s|j[áa] sou cliente/.test(
      t,
    )
  ) {
    return 'cliente_fechado';
  }
  if (/desconto|negociar|parcelar|condi[çc][ãa]o|abatimento|melhor pre[çc]o|muito caro|baixar o valor/.test(t)) {
    return 'negociar';
  }
  if (/agendar.*visita|marcar.*visita|visita|posso visitar|quero conhecer|ir a[íi] conhecer/.test(t)) {
    return 'agendar_visita';
  }
  return 'seguir_fluxo';
}

function detectarAfirmativo(t: string): boolean {
  return /\b(sim|quero|pode ser|gostaria|claro|com certeza|pode mandar|manda|aceito|isso)\b/.test(t);
}

function extrairDataEvento(t: string): string | undefined {
  const m = t.match(/dia\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
  return m ? m[1] : undefined;
}

export class MockNLU implements NLU {
  async analisar(textoBruto: string, _conversa: Conversa): Promise<EntradaNLU> {
    const t = normalizar(textoBruto);
    const intencao = detectarIntencao(t);
    const entrada: EntradaNLU = {
      slots: extrairSlots(t),
      intencao,
      afirmativo: detectarAfirmativo(t),
    };
    if (intencao === 'cliente_fechado') {
      const dataEvento = extrairDataEvento(t);
      if (dataEvento) entrada.dataEventoDetectada = dataEvento;
    }
    return entrada;
  }
}
