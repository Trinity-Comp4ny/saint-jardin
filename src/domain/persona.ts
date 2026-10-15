// Persona e mensagens prontas da Raquel. Fonte única dos textos que o bot envia.
// Regra: o agente não inventa preço. Onde há valor, é a mensagem literal da Raquel.

export const PERSONA = {
  nome: 'Raquel',
} as const;

const ABERTURA_CORPO =
  'Me chamo Raquel e darei continuidade ao seu atendimento.\n\n' +
  'Antes de conversarmos sobre os detalhes do seu evento, gostaria de te apresentar ' +
  'um pouco do que torna o Saint Jardin um Destination Wedding tão especial. ' +
  'Vou te enviar um breve vídeo de apresentação do nosso espaço.\n\n' +
  'Espero que seja o início de uma experiência inesquecível conosco. ✨';

export const MSG = {
  // Primeira mensagem de quem pede orçamento (texto literal da Raquel, 14/10/2026).
  // Vem antes do vídeo de apresentação. Não pergunta o nome: se a pessoa se
  // apresentar, a NLU captura sozinha.
  abertura: `Olá, tudo bem? ${ABERTURA_CORPO}`,

  // Mesma abertura sem o "Olá, tudo bem?", para quando o bot já cumprimentou na
  // mensagem anterior (comoPosso): evita dois cumprimentos seguidos.
  aberturaSemSaudacao: ABERTURA_CORPO,

  // Primeira mensagem que é SÓ um cumprimento: o fluxo comercial (vídeo, perguntas)
  // só começa quando a pessoa disser que quer orçamento. Protege quem já fechou,
  // fornecedor e assessoria, que a lista de contatos não cobre (100+).
  // O trecho institucional é da própria Raquel ("Saint Jardin Eventos agradece seu
  // contato"). Não diz o nome: a abertura seguinte já se apresenta.
  comoPosso:
    'Olá, tudo bem? O Saint Jardin Eventos agradece seu contato. Como posso ajudar?',

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

  // A pessoa pediu 2029. Orientação da Raquel (15/10/2026): dizer que a agenda de 2029 abre em
  // janeiro de 2027 e mandar os valores de 2028 como base, para ela poder marcar uma visita
  // (é na visita que se negocia). O bot segue o fluxo normal com 2028, que manda o PDF.
  agenda2029:
    'Vamos abrir a agenda de 2029 em janeiro de 2027, mas já posso te enviar os valores de ' +
    '2028 para você ter uma base e poder marcar uma visita. Aí a gente conversa sobre as ' +
    'condições! ☺️',

  // Proposta normal: a mensagem de ano (literal da Raquel) antecede o PDF do ano.
  // A descrição de inclusos saiu: vive dentro do PDF.
  propostaAno: (ano: number): string =>
    `Vou te enviar nossa proposta para casamentos em ${ano}, especialmente preparada ` +
    `para que os noivos possam vivenciar uma experiência única no Saint Jardin.\n` +
    `Nosso foco como espaço é o Destination Wedding para que o sonho de vocês não se ` +
    `limite em apenas uma noite!`,

  ofertaMini:
    'Temos propostas de mini wedding para evento de até 80 convidados em dia ' +
    'de semana (segunda a quinta-feira, exceto feriados ou vésperas). Teria ' +
    'interesse em receber?',

  // O mini wedding tem PDF próprio (2027 e 2028 na mesma proposta), então o
  // preço e os detalhes vivem no arquivo. Anúncio curto que antecede o PDF.
  orcamentoMiniAnuncio: 'Certo, segue PDF com o orçamento do mini wedding:',

  // A pessoa não disse sim nem não à oferta do mini (perguntou preço, o que
  // inclui, "vou ver com meu noivo"): manda o PDF com as informações.
  miniInformacoes: 'Segue nosso PDF de mini wedding com as informações:',

  // A pessoa recusou o mini: pergunta se pode mandar as propostas tradicionais
  // (que incluem final de semana). Se aceitar, vai o PDF do ano pedido.
  ofertaTradicional:
    'Podemos então enviar nossas propostas tradicionais que incluem o final de semana também?',

  // Logo depois de QUALQUER proposta (PDF), texto literal da Raquel (15/10/2026). A
  // noiva só precisa responder se quer visitar. O follow-up de 12h repete o convite.
  conviteVisitaPosProposta:
    'O que acharam da proposta? Gostaria de agendar uma visita para conhecer nosso ' +
    'espaço pessoalmente? É ainda mais lindo! ✨',

  // Convite de visita (texto literal da Raquel): diz quando há visita e pergunta o
  // dia. Carrega regra de horário, então vai literal (nunca humanizada).
  // Só sai quando a pessoa aceita ou pede a visita (ou responde ao follow-up).
  perguntaPreferenciaVisita:
    'Realizamos visitas de segunda a sexta-feira, em horário comercial, e aos ' +
    'sábados, das 8h às 13h.\n' +
    'Que dia ficará melhor para vocês?',

  // O pedido de visita cai fora do horário anunciado (domingo, sábado à tarde, noite...).
  // Em vez de um "não" seco, o bot abre uma exceção a ser avaliada pela equipe.
  visitaExcecao: (quando: string): string =>
    `Entendi! Vou ver aqui com a equipe se conseguimos abrir uma exceção para ${quando} ` +
    `e já te retorno, ok? ☺️`,

  // A noiva NÃO deu um dia/horário fechado (só preferência ou deixou em aberto). O
  // bot não tem acesso ao calendário, então NÃO promete "esse dia": diz que vai ver
  // um dia e horário na agenda e repassa para a Raquel.
  visitaVouRetornar:
    'Vou ver um dia e horário na agenda e já te retorno para combinarmos, ok?',

  // A noiva já deu um dia e horário concretos: o bot acusa o que ela pediu e
  // repassa para a Raquel confirmar (o bot não fecha a agenda sozinho).
  // Sempre em 1ª pessoa: o bot SE APRESENTA como Raquel, então nunca pode dizer
  // "vou confirmar com a Raquel" (quebra a persona na cara da cliente).
  visitaComData: (quando: string): string =>
    `Perfeito, anotei ${quando}. Vou confirmar aqui na agenda e já te retorno, ok? ☺️`,

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

  // Não é noiva buscando orçamento (fornecedor, parceria, imprensa): o bot acusa
  // o recebimento e a Raquel de verdade assume dali (1ª pessoa: a persona É a
  // Raquel, não pode "chamar a Raquel").
  fornecedorEncaminhar:
    'Entendi! Já te atendo direitinho, só um instante, ok? ☺️',

  // Dúvida fora do script ou pedido de negociação logo no PRIMEIRO contato:
  // apresenta o espaço e avisa que já responde a pergunta (a Raquel assume).
  duvidaVouVerificar:
    'Sobre o que você perguntou, vou verificar direitinho e já te respondo, ok? ☺️',

  pedirDadosFaltantes: (faltando: string[], i = 0): string => {
    const o = faltando.join(' e ');
    const variantes = [
      `Só para fechar seu orçamento certinho, você pode me confirmar ${o}?`,
      `Para fechar seu orçamento, me confirma ${o}, por favor?`,
      `Para seguir com seu orçamento, preciso saber ${o}. Pode me confirmar?`,
    ];
    // Indexação blindada tipo `vary()`: `i % 3` cru quebraria com seed
    // negativo/NaN (array[-1]/array[NaN] = undefined, mensagem sairia vazia).
    const idx = ((i % variantes.length) + variantes.length) % variantes.length;
    return variantes[idx] ?? variantes[0] ?? '';
  },

  // `data` chega em DD/MM/YYYY e `alternativa` já descrita ("sábado (16/10/2027)"):
  // nunca ISO cru na conversa com a cliente.
  dataIndisponivel: (data: string, alternativa: string): string =>
    `Poxa, a data ${data} já está reservada. 😕 Consigo te oferecer ${alternativa}. ` +
    `Teria essa ou outra data em mente?`,

  // O calendário não achou nenhuma data livre à frente para sugerir.
  dataIndisponivelSemAlternativa: (data: string): string =>
    `Poxa, a data ${data} já está reservada. 😕 Você teria outra data em mente?`,

  dataNoPassado: [
    'Essa data já passou. ☺️ Você tem uma data mais pra frente em mente?',
    'Ah, essa data já passou! Qual data você pensou, mais pra frente? 😊',
  ],

  // Follow-up 12h depois da proposta, se a pessoa não escreveu (texto literal da
  // Raquel, 14/10/2026). Faz o papel do convite de visita, que saiu da proposta.
  followUp:
    'Oie! Ficou alguma dúvida sobre nossa proposta? 🥰\n\n' +
    'Tenho certeza de que o Saint Jardin irá surpreender vocês ainda mais ' +
    'pessoalmente! ✨ A visita também é uma ótima oportunidade para conversarmos ' +
    'sobre os detalhes e possibilidades de adequar a proposta ao que vocês desejam.\n\n' +
    'Vamos agendar uma visita para conhecer nosso espaço? Será um prazer receber vocês!',

  // Transcrição do áudio falhou (Gemini indisponível, rate limit, formato etc.).
  // Diz o que houve e o próximo passo, sem termos técnicos e sem culpar a noiva.
  // 1ª pessoa (a persona é a Raquel): nada de "vou chamar a Raquel".
  audioNaoEntendido:
    'Recebi seu áudio, mas não consegui ouvir direito por aqui. ' +
    'Pode me mandar por texto, por favor? ☺️',

  // Rede de segurança: qualquer erro inesperado no processamento do turno
  // (não só transcrição). Mesmo tom: o que houve e o próximo passo, sem
  // termo técnico e sem culpar a cliente.
  erroInesperado:
    'Tive um problema aqui pra processar sua mensagem. Já já te respondo, ok? ☺️',

  // Figurinha, reação (👍), imagem, documento, localização etc.: o bot não lê
  // nada disso. Sem essa resposta, quem reage achando que respondeu ficava
  // sem retorno nenhum, achando que travou.
  tipoNaoSuportado:
    'Por aqui só consigo entender texto e áudio. Pode me responder em texto? ☺️',
} as const;
