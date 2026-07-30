// Persona e mensagens prontas da Raquel. Fonte única dos textos que o bot envia.
// Regra: o agente não inventa preço. Onde há valor, é a mensagem literal da Raquel.

export const PERSONA = {
  nome: 'Raquel',
} as const;

export const MSG = {
  apresentacao:
    `Olá, tudo bem?! Me chamo ${PERSONA.nome}, muito prazer!\n` +
    `Primeiramente, quero agradecer pelo contato. ☺️\n` +
    `Vou te encaminhar nossa apresentação com as informações do espaço!`,

  perguntaQualificadora:
    'Para orçamento, você poderia me informar a data e o ano do evento ' +
    '(se tem preferência por sábado, domingo ou dia de semana) e o número ' +
    'estimado de convidados, por gentileza?!',

  perguntaData: 'Você já tem uma data em mente para o evento? ☺️',

  perguntaAno: 'E o evento seria para qual ano, 2027 ou 2028?',

  // Dia de semana com mais de 80 convidados: não cabe no mini. Explicamos o
  // limite e esperamos a noiva confirmar que quer a proposta normal.
  explicaLimiteNormal: (convidados: number): string =>
    `Em dia de semana, nosso formato mini wedding atende até 80 convidados. ` +
    `Para ${convidados} não se enquadra no mini, mas posso te passar nossa ` +
    `proposta normal, que também vale para fim de semana. Quer que eu te envie? ☺️`,

  orcamentoNormal:
    'Certo, segue PDF com orçamento:\n\n' +
    'Oferecemos aos clientes 8hrs de evento.\n' +
    'Também incluímos no aluguel mesas e cadeiras para até 200 convidados, ' +
    '2 funcionários no dia do evento, luz de palco e pista, alguns móveis ' +
    'rústicos para compor a decoração, três opções de áreas de cerimônia, ' +
    'além de dois salões de festa.\n' +
    'Não temos Buffet e nem decoração inclusa.',

  ofertaMini:
    'Temos propostas de mini wedding para evento de até 80 convidados em dia ' +
    'de semana (segunda a quinta-feira, exceto feriados ou vésperas). Teria ' +
    'interesse em receber?',

  orcamentoMini:
    'Certo, segue orçamento para mini wedding:\n\n' +
    'Oferecemos aos clientes 6h de evento.\n' +
    'Também incluímos no aluguel mesas e cadeiras para até 65 convidados, ' +
    '1 funcionário no dia do evento, um salão com ar Toscano da Itália bem em ' +
    'frente a nossa linda Capela, além de três opções de áreas de cerimônia.\n\n' +
    '*proposta válida para eventos de segunda a quinta-feira (exceto feriados ' +
    'e vésperas de feriado), com limite máximo de 65 convidados.',

  conviteVisita:
    'Vamos agendar um dia para você conhecer nossa estrutura e analisar a ' +
    'experiência que oferecemos no Saint Jardin?',

  pedirDadosFaltantes: (faltando: string[]): string =>
    `Só pra eu montar seu orçamento certinho, você pode me confirmar ${faltando.join(
      ' e ',
    )}? ☺️`,

  dataIndisponivel: (data: string, alternativa: string): string =>
    `Poxa, a data ${data} já está reservada. 😕 Consigo te oferecer ${alternativa}. ` +
    `Teria essa ou outra data em mente?`,

  // Placeholder: o Matheus troca depois pelo texto real da Raquel.
  followUp:
    'Oi! Passando pra saber se ficou alguma dúvida sobre o Saint Jardin. ' +
    'Posso te ajudar a garantir sua data? ☺️',
} as const;
