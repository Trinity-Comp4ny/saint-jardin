import type { Ano, TipoPdf } from './types';

/** Catálogo dos PDFs que a Raquel envia. O preço vive dentro do PDF. */
export const PDF_CATALOGO: Record<TipoPdf, { arquivo: string; descricao: string }> = {
  apresentacao: {
    arquivo: 'Saint Jardin Eventos.pdf',
    descricao: 'Apresentação do espaço',
  },
  proposta_2027: {
    arquivo: 'Proposta Hospedagem Saint Jardin - 2027.pdf',
    descricao: 'Proposta com hospedagem 2027',
  },
  proposta_2028: {
    arquivo: 'Proposta hospedagem 2028.pdf',
    descricao: 'Proposta com hospedagem 2028',
  },
};

export function pdfPropostaPorAno(ano: Ano): TipoPdf {
  return ano === 2027 ? 'proposta_2027' : 'proposta_2028';
}
