// Utilidades de texto para saída de LLM.

const NOMEADAS: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä',
  eacute: 'é', egrave: 'è', ecirc: 'ê',
  iacute: 'í', oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ',
  uacute: 'ú', ugrave: 'ù', ccedil: 'ç',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã',
  Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ',
  Uacute: 'Ú', Ccedil: 'Ç',
};

/**
 * Decodifica entidades HTML ("s&#225;bado" -> "sábado"). O Gemini às vezes devolve
 * texto escapado em campos de string, e isso chegava literal à noiva e ao alerta.
 */
export function decodificarEntidades(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (todo, ent: string) => {
    if (ent.startsWith('#x') || ent.startsWith('#X')) {
      const cp = parseInt(ent.slice(2), 16);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : todo;
    }
    if (ent.startsWith('#')) {
      const cp = parseInt(ent.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : todo;
    }
    return NOMEADAS[ent] ?? todo;
  });
}

/**
 * Texto curto vindo do LLM que entra literal numa mensagem ou no alerta da Raquel (nome,
 * serviço, noivos): decodifica entidades, tira quebra de linha e controle (senão forjava
 * linha extra no alerta), colapsa espaço e limita o tamanho. Vazio vira `undefined`.
 */
export function sanitizarTextoCurto(bruto: string, max = 60): string | undefined {
  const limpo = decodificarEntidades(bruto).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return limpo || undefined;
}

// Cumprimento puro: tirando as palavras de abertura e a pontuação, não sobra nada.
const SAUDACAO =
  'oi+e?|ol[áa]|opa|e a[íi]|bom dia|boa tarde|boa noite|tudo bem|td bem|tudo bom|como vai|tudo certo';

/** A mensagem é só um cumprimento ("oi", "bom dia", "tudo bem?"), sem pedido nem dado. */
export function ehSaudacaoPura(t: string): boolean {
  if (!new RegExp(`(?<![a-zà-ú])(${SAUDACAO})(?![a-zà-ú])`).test(t)) return false;
  const resto = t
    .replace(new RegExp(`(?<![a-zà-ú])(${SAUDACAO})(?![a-zà-ú])`, 'g'), ' ')
    .replace(/[^a-zà-ú0-9]+/g, ' ')
    .trim();
  return resto === '';
}

