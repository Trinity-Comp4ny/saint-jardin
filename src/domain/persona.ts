// Persona e mensagens prontas da Raquel. Fonte única dos textos que o bot envia.
// Regra: o agente não inventa preço. Onde há valor, é a mensagem literal da Raquel.

export const PERSONA = {
  nome: 'Raquel',
} as const;

export const MSG = {
  // Saudação do primeiro contato, determinística. Se já sabemos o nome (a noiva se
  // apresentou), personaliza ("Oii Ester, tudo bem?..."); se não, cumprimenta e já
  // pergunta o nome na própria saudação ("...muito prazer! Com quem eu falo?").
  apresentacao: (nome?: string): string => {
    const abertura = nome
      ? `Oii ${nome}, tudo bem? Me chamo ${PERSONA.nome}, muito prazer!`
      : `Olá, tudo bem?! Me chamo ${PERSONA.nome}, muito prazer! Com quem eu falo?`;
    return (
      `${abertura}\n` +
      `Primeiramente, quero agradecer pelo contato. ☺️\n` +
      `Vou te encaminhar nossa apresentação com as informações do espaço!`
    );
  },

  perguntaQualificadora:
    'Para orçamento, você poderia me informar a data e o ano do evento ' +
    '(se tem preferência por sábado, domingo ou dia de semana) e o número ' +
    'estimado de convidados, por gentileza?!',

  // Variantes: escolhidas por um seed da mensagem, para não repetir a mesma
  // frase quando a noiva responde algo que não avança (a 1ª é a "canônica").
  // Imperativa e pedindo tudo de uma vez: uma pergunta de sim/não ("já tem data
  // em mente?") faz a noiva responder "sim" sem avançar, virando loop.
  // Pergunta aberta pela data. Convida a data exata, mas deixa claro que só o ano
  // (2027 ou 2028) já basta para o orçamento — assim ninguém fica travado sem
  // saber o dia. Evita pergunta de sim/não ("já tem data?"), que vira loop de "sim".
  perguntaData: [
    'Qual a data que você está planejando para o evento? Se ainda não tiver o dia, só o ano (2027 ou 2028) já me ajuda com o orçamento.',
    'Qual a data do evento? Pode ser dia, mês e ano, ou só o ano (2027 ou 2028) por enquanto.',
    'Para seguir com o orçamento, qual a data do evento (ou pelo menos o ano, 2027 ou 2028)?',
  ],

  perguntaAno: [
    'E o evento seria para qual ano, 2027 ou 2028?',
    'Só me confirma o ano, por favor: 2027 ou 2028?',
  ],

  // A noiva disse só o mês ("outubro"): pergunta o dia daquele mês, mas convida o
  // ano como alternativa, para não ficar preso pedindo um dia que ela talvez não tenha.
  perguntaDiaDoMes: (mes: number): string => {
    const nomes = [
      'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
    ];
    const nome = nomes[mes - 1];
    const base = nome ? `Qual dia de ${nome} você está pensando?` : 'Qual dia você está pensando?';
    return `${base} Se ainda não decidiu o dia, me diz só o ano (2027 ou 2028) que já sigo com o orçamento.`;
  },

  // Texto literal da Raquel, quebrado em duas mensagens (anúncio + descrição) para
  // não chegar como um paredão único. O PDF entra entre as duas. NÃO reescrever a
  // copy: só a divisão muda.
  orcamentoNormalAnuncio: 'Certo, segue PDF com orçamento:',
  orcamentoNormalDescricao:
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

  // O mini wedding agora tem PDF próprio (2027 e 2028 na mesma proposta), então o
  // preço e os detalhes vivem no arquivo, não na mensagem. Aqui vai só o anúncio
  // curto que antecede o PDF, no mesmo formato do orçamento normal.
  orcamentoMiniAnuncio: 'Certo, segue PDF com o orçamento do mini wedding:',

  conviteVisita:
    'Vamos agendar um dia para você conhecer nossa estrutura e analisar a ' +
    'experiência que oferecemos no Saint Jardin?',

  // Visita de noiva: PRIMEIRO só pergunta o melhor dia/horário para a noiva
  // (sem prometer a agenda ainda). Só DEPOIS que ela responde é que a Raquel
  // diz que vai verificar a própria agenda (visitaVouRetornar).
  perguntaPreferenciaVisita:
    'Você tem algum dia ou horário de preferência para fazer a visita?',

  // A noiva NÃO deu um dia/horário fechado (só preferência ou deixou em aberto). O
  // bot não tem acesso ao calendário, então NÃO promete "esse dia": diz que vai ver
  // um dia e horário na agenda e repassa para a Raquel.
  visitaVouRetornar:
    'Vou ver um dia e horário na agenda e já te retorno para combinarmos, ok?',

  // A noiva já deu um dia e horário concretos: o bot acusa o que ela pediu e
  // repassa para a Raquel confirmar (o bot não fecha a agenda sozinho).
  visitaComData: (quando: string): string =>
    `Perfeito, anotei ${quando}. Vou confirmar com a Raquel e já te retorno, ok? ☺️`,

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
    'Perfeito! Vou verificar a disponibilidade e já te retorno, ok? ☺️',

  // A noiva recusou o convite (ou se despediu). Agradece UMA vez, deixa a porta
  // aberta e para de puxar visita. NÃO termina com pergunta (não é um convite).
  encerramento: [
    'Combinado! Fico à disposição. Se quiser retomar os valores, tirar dúvidas ou marcar uma visita, é só me chamar. 🌿',
    'Sem problemas! Qualquer coisa sobre datas, valores ou uma visita, estou por aqui quando precisar. ☺️',
    'Tranquilo! Quando fizer sentido, me chama que a gente continua de onde parou. 🌿',
  ],

  // Não é noiva buscando orçamento (fornecedor, parceria, imprensa): o bot avisa
  // que vai chamar a Raquel, em vez de empurrar o script de qualificação.
  fornecedorEncaminhar:
    'Entendi! Nesse caso vou chamar a Raquel para te atender diretinho, ok? ' +
    'Um instante. ☺️',

  pedirDadosFaltantes: (faltando: string[], i = 0): string => {
    const o = faltando.join(' e ');
    const variantes = [
      `Só para fechar seu orçamento certinho, você pode me confirmar ${o}?`,
      `Perfeito! Para fechar seu orçamento, me confirma ${o}?`,
      `Legal! Só preciso saber ${o} para seguir com seu orçamento.`,
    ];
    // Indexação blindada tipo `vary()`: `i % 3` cru quebraria com seed
    // negativo/NaN (array[-1]/array[NaN] = undefined, mensagem sairia vazia).
    const idx = ((i % variantes.length) + variantes.length) % variantes.length;
    return variantes[idx] ?? variantes[0] ?? '';
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

  // Transcrição do áudio falhou (Gemini indisponível, rate limit, formato etc.).
  // Diz o que houve e o próximo passo, sem termos técnicos e sem culpar a noiva.
  audioNaoEntendido:
    'Recebi seu áudio, mas não consegui ouvir direito por aqui. ' +
    'Pode me mandar por texto? Já vou chamar a Raquel para dar uma olhada também. ☺️',

  // Rede de segurança: qualquer erro inesperado no processamento do turno
  // (não só transcrição). Mesmo tom: o que houve e o próximo passo, sem
  // termo técnico e sem culpar a cliente.
  erroInesperado:
    'Tive um problema aqui pra processar sua mensagem. Já chamei a Raquel ' +
    'pra te ajudar, ok? ☺️',

  // Figurinha, reação (👍), imagem, documento, localização etc.: o bot não lê
  // nada disso. Sem essa resposta, quem reage achando que respondeu ficava
  // sem retorno nenhum, achando que travou.
  tipoNaoSuportado:
    'Por aqui só consigo entender texto e áudio. Pode me responder em texto? ☺️',
} as const;
