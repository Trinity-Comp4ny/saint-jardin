// Controle do "verniz" do Redator (LLM). O texto-objetivo da máquina de estados é
// a fonte da verdade; o LLM só pode adicionar cortesia a uma conversa social que
// de fato existe. Estas regras são determinísticas para não depender de o modelo
// obedecer ao prompt.

const SOCIAL = [
  'oi+e?', 'ol[áa]', 'opa', 'e a[íi]',
  'bom dia', 'boa tarde', 'boa noite',
  'tudo bem', 'td bem', 'tudo bom', 'tudo certo', 'como vai', 'como est[aá]',
  'obrigad[oa]', 'valeu', 'vlw',
  'um minuto', 'um minutinho', 'um momento', 'um instante',
  'j[áa] (te )?(mando|envio|passo|volto)', 'vou (te )?(mandar|enviar|passar)',
  'j[áa] volto', 'pera( a[íi])?',
].join('|');

const RE_SOCIAL = new RegExp(`(?<![a-zà-ú])(${SOCIAL})(?![a-zà-ú])`, 'i');

/**
 * A mensagem da pessoa tem conversa social (cumprimento, "tudo bem?", agradecimento,
 * "um minuto")? Sem isso não há o que o Redator responder: a pergunta vai literal.
 */
export function temConversaSocial(mensagemCliente: string): boolean {
  return RE_SOCIAL.test(mensagemCliente);
}

// Abertura que comenta o que a pessoa disse ("Legal!", "Ah, então...").
const RE_INTERJEICAO = /^\s*(legal|ah+|ahn|uau|nossa|show|beleza|maravilha|perfeito|[óo]timo|excelente|massa|opa|ent[ãa]o|que (bom|legal|massa))(?![a-zà-ú])/i;
// Gíria e muleta de fala que não combinam com a Raquel.
const RE_GIRIA = /(?<![a-zà-ú])(e tal|tipo assim|blz|vlw|n[ée]\?)(?![a-zà-ú])/i;

const numeros = (t: string): string[] => t.match(/\d+/g) ?? [];

/**
 * A resposta do Redator é aceitável? Rejeita (e o chamador usa o objetivo literal):
 * abertura com interjeição ou gíria que o objetivo não tinha, números novos (preço,
 * data, convidados que o modelo inventou) e texto muito maior que o objetivo.
 */
export function respostaDoRedatorAceitavel(objetivo: string, saida: string): boolean {
  if (!saida.trim()) return false;
  if (RE_INTERJEICAO.test(saida) && !RE_INTERJEICAO.test(objetivo)) return false;
  if (RE_GIRIA.test(saida) && !RE_GIRIA.test(objetivo)) return false;
  const permitidos = new Set(numeros(objetivo));
  if (numeros(saida).some((n) => !permitidos.has(n))) return false;
  if (saida.length > objetivo.length * 2 + 140) return false;
  return true;
}
