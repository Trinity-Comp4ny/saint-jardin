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

  // Variantes: escolhidas por um seed da mensagem, para não repetir a mesma
  // frase quando a noiva responde algo que não avança (a 1ª é a "canônica").
  // Imperativa e pedindo tudo de uma vez: uma pergunta de sim/não ("já tem data
  // em mente?") faz a noiva responder "sim" sem avançar, virando loop.
  perguntaData: [
    'Qual a data que você pensou para o casamento? Me diz o dia, o mês e o ano (2027 ou 2028). ☺️',
    'Me conta a data do evento: dia, mês e ano (2027 ou 2028)? 😊',
    'Para seguir com seu orçamento, qual o dia, mês e ano (2027 ou 2028) do casamento?',
  ],

  perguntaAno: [
    'E o evento seria para qual ano, 2027 ou 2028?',
    'Só me confirma o ano, por favor: 2027 ou 2028? ☺️',
  ],

  // Já sabemos o mês (a noiva disse "outubro") e falta o dia: pergunta direto o
  // dia daquele mês, em vez de repetir a pergunta genérica de data.
  perguntaDiaDoMes: (mes: number): string => {
    const nomes = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ];
    const nome = nomes[mes - 1];
    return nome ? `Qual dia de ${nome} você pensou? ☺️` : 'Qual dia você pensou? ☺️';
  },

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

  // Texto literal da Raquel (_chat.txt). Ao contrário do evento normal, o mini
  // wedding não tem PDF: o preço vai na própria mensagem.
  orcamentoMini:
    'Certo, segue orçamento para mini wedding:\n\n' +
    'Oferecemos aos clientes 6h de evento.\n' +
    'Também incluímos no aluguel mesas e cadeiras para até 65 convidados, ' +
    '1 funcionário no dia do evento, um salão com ar Toscano da Itália bem em ' +
    'frente a nossa linda Capela, além de três opções de áreas de cerimônia.\n\n' +
    '*proposta válida para eventos de segunda a quinta-feira (exceto feriados ' +
    'e vésperas de feriado), com limite máximo de 65 convidados.\n\n' +
    'O investimento para sua data é a partir de R$27.900,00 para 2027 ou ' +
    'R$29.900,00 para 2028.\n\n' +
    'Também posso oferecer alguns pacotes de hospedagem personalizados e ' +
    'exclusivos na visita para entender qual proposta mais se adequa ao seu evento.',

  conviteVisita:
    'Vamos agendar um dia para você conhecer nossa estrutura e analisar a ' +
    'experiência que oferecemos no Saint Jardin?',

  // Visita de noiva: PRIMEIRO só pergunta o melhor dia/horário para a noiva
  // (sem prometer a agenda ainda). Só DEPOIS que ela responde é que a Raquel
  // diz que vai verificar a própria agenda (visitaVouRetornar).
  perguntaPreferenciaVisita:
    'Você tem algum dia ou horário de preferência para fazer a visita?',

  visitaVouRetornar:
    'Vou verificar minha agenda para esse dia e já te retorno para combinarmos, tá?',

  // Visita técnica (fornecedor de casamento fechado): regra e validação.
  perguntaDataVisitaTecnica:
    'Nossas visitas técnicas são de terça a sexta, com pelo menos 30 dias de ' +
    'antecedência. Para qual data seria? ☺️',

  visitaTecnicaForaRegra: (motivo: 'fim_de_semana' | 'antecedencia'): string =>
    motivo === 'fim_de_semana'
      ? 'A visita técnica é feita de terça a sexta. Tem algum dia dentro desses? ☺️'
      : 'A visita técnica precisa ser marcada com pelo menos 30 dias de ' +
        'antecedência. Consegue uma data um pouco mais para frente? ☺️',

  visitaTecnicaVouVerificar:
    'Perfeito! Vou verificar a disponibilidade e já te retorno, tá? ☺️',

  pedirDadosFaltantes: (faltando: string[], i = 0): string => {
    const o = faltando.join(' e ');
    return [
      `Só pra eu montar seu orçamento certinho, você pode me confirmar ${o}? ☺️`,
      `Perfeito! Pra fechar seu orçamento, me confirma ${o}? 😊`,
      `Legal! Só preciso saber ${o} pra seguir com seu orçamento. ☺️`,
    ][i % 3] as string;
  },

  dataIndisponivel: (data: string, alternativa: string): string =>
    `Poxa, a data ${data} já está reservada. 😕 Consigo te oferecer ${alternativa}. ` +
    `Teria essa ou outra data em mente?`,

  dataNoPassado: [
    'Essa data já passou. ☺️ Você tem uma data mais pra frente em mente?',
    'Ah, essa data já passou! Qual data você pensou, mais pra frente? 😊',
  ],

  // Placeholder: o Matheus troca depois pelo texto real da Raquel.
  followUp:
    'Oi! Passando pra saber se ficou alguma dúvida sobre o Saint Jardin. ' +
    'Posso te ajudar a garantir sua data? ☺️',
} as const;
