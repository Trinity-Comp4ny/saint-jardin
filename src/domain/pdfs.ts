import type { Ano, TipoPdf, TipoVideo } from './types';

/** Catálogo dos PDFs que a Raquel envia. O preço vive dentro do PDF. */
export const PDF_CATALOGO: Record<TipoPdf, { arquivo: string; descricao: string }> = {
  proposta_2027: {
    arquivo: 'Proposta Saint Jardin 2027.pdf',
    descricao: 'Proposta com hospedagem 2027',
  },
  proposta_2028: {
    arquivo: 'Proposta Saint Jardin 2028.pdf',
    descricao: 'Proposta com hospedagem 2028',
  },
  proposta_mini: {
    arquivo: 'Proposta Mini Wedding.pdf',
    descricao: 'Proposta de mini wedding (2027 e 2028)',
  },
};

/**
 * Vídeo de apresentação do espaço (substitui o PDF de 37 páginas). MP4 H.264/AAC
 * de até 16 MB: é o teto da Cloud API para vídeo.
 */
export const VIDEO_CATALOGO: Record<TipoVideo, { arquivo: string; descricao: string }> = {
  apresentacao: {
    arquivo: 'apresentacao-saint-jardin.mp4',
    descricao: 'Vídeo de apresentação do espaço',
  },
};

export function pdfPropostaPorAno(ano: Ano): TipoPdf {
  // Defesa em profundidade: o tipo `Ano` (2027|2028) e o Zod na extração já
  // impedem isso na prática, mas mandar PDF/preço errado em silêncio (o que o
  // ternário original fazia pra qualquer valor != 2027) é pior que travar o
  // turno — `processarFila` já captura qualquer exceção sem derrubar o resto
  // do lote nem deixar a cliente sem resposta (vai pra handoff avisada).
  if (ano !== 2027 && ano !== 2028) {
    throw new Error(`pdfPropostaPorAno: ano inválido (${String(ano)}); só 2027 ou 2028 são vendáveis`);
  }
  return ano === 2027 ? 'proposta_2027' : 'proposta_2028';
}
