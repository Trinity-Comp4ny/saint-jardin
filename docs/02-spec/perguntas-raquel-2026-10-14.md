# Perguntas para a Raquel: fechar o fluxo novo (14/10/2026)

Objetivo: cobrir o que o bot deve responder em cada situação do fluxo novo antes de implementar.
A parte 1 é para enviar à Raquel. A parte 2 é de apoio (cenários e o que o bot faz hoje).

Decisões já tomadas (não perguntar de novo):

- O convite de visita só sai no follow-up de 12h (não vai mais junto da proposta).
- Depois de aceitar o mini wedding, vale o anúncio curto atual antes do PDF.
- Mini wedding: só dia de semana (seg a qui), até 80 convidados.
- Fim de semana ou mais de 80 convidados: proposta normal do ano.

---

## Versão curta: 5 perguntas para enviar agora

Critério: sem a resposta, o bot erra com dinheiro ou perde lead, e não existe um padrão seguro que
dê para adotar sozinho. As outras 35 perguntas seguem abaixo, mas ficam para depois (ver o padrão
adotado no fim desta seção).

Texto para copiar:

> Quel, preciso confirmar 5 coisas para fechar o fluxo novo:
>
> 1. Se a pessoa disser "não" para o mini wedding (sem dizer mais nada), o que o bot faz? (a) se despede e fica quieto; (b) pergunta se ela prefere outra data ou final de semana; (c) manda a proposta normal, que já tem os valores de segunda a quinta.
> 2. Se, em vez de "sim" ou "não", ela perguntar sobre o mini ("quanto é?", "o que inclui?", "tem hospedagem?"), o bot manda o PDF do mini na hora?
> 3. No PDF de 2028, a Proposta II de segunda a quinta está R$58.000, igual ao de 2027. Está certo ou deveria subir?
> 4. Sobre o follow-up de 12h: é só um, ou manda outro depois (3 ou 7 dias)? E qual a janela de horário para enviar (sugiro das 8h às 20h; se as 12h caírem de madrugada, vai às 8h)?
> 5. Para o bot não responder quem já fechou, preciso da lista de clientes fechados (nome, telefone e data do evento). Quem passa e mantém essa lista? Uma planilha serve?

Por que estas cinco:

| # | Vem de | Risco se ficar sem resposta |
|---|---|---|
| 1 | 13 a 15 | Hoje o bot encerra. Pode estar descartando lead que aceitaria o valor normal de dia de semana |
| 2 | 17, 18 | Hoje não manda o PDF e manda um convite de visita. É o caso mais comum depois da oferta do mini |
| 3 | 29 | Possível erro de preço num PDF que vai para o cliente |
| 4 | 22, 23, 24, 25 | Define o job novo (quantos envios, janela de horário). Sem isso eu chuto o desenho do job |
| 5 | 37, 38 | A Raquel já reclamou em 31/07 de mensagem automática para quem fechou. Sem a lista, o bot não sabe quem é |

Padrão adotado para as demais, se não forem perguntadas (revisar nos testes com a Raquel):

- Nome: a abertura não pergunta. Se a pessoa se apresentar, o bot usa o nome.
- "Darei continuidade ao seu atendimento": mantida literal.
- Abertura já com dados: abertura, vídeo e proposta, sem repetir a pergunta.
- Dúvida específica na abertura: abertura, vídeo, aviso de que vai verificar, e passa para a Raquel.
- "ok" ou "obrigada" depois da proposta: silêncio até o follow-up.
- Mais de 240 convidados: passa para a Raquel.
- Feriado e véspera no mini: feriados nacionais, e a proposta normal nesses dias.
- Visita fora da regra de horário: o bot anota e repassa, sem validar.
- Foto, figurinha, PDF: resposta atual mantida.
- Fornecedor e visita técnica: regras atuais mantidas.
- Dúvida pós-proposta (desconto, buffet próprio, parcelamento): passa para a Raquel em silêncio.
- "É robô?": decisão do Matheus, não da Raquel. Sugestão: assumir que é assistente virtual.

---

## Parte 1. Lista completa para enviar à Raquel (40 perguntas)

Responder por áudio está ótimo. Se a resposta for "do jeito que está", basta dizer.

### A. Primeira mensagem

1. O texto de abertura não pergunta o nome ("Com quem eu falo?"). Pode ficar sem? O bot só vai saber o nome se a pessoa se apresentar sozinha. Se ela se apresentar, o bot pode usar o nome nas mensagens seguintes?
2. A frase "darei continuidade ao seu atendimento" supõe que antes houve uma mensagem automática (tipo "Saint Jardin Eventos agradece seu contato"). Essa mensagem anterior existe no número novo? Se não existir, mantemos a frase mesmo assim?
3. Se a pessoa já abrir a conversa com dados ("quero orçar sábado, 2028, 150 pessoas"), o bot manda: abertura, vídeo e já a proposta, sem repetir a pergunta de data e convidados. Pode ser assim?
4. Se a pessoa abrir com uma dúvida específica ("vocês têm buffet?", "aceita pet?"), o bot manda a abertura e o vídeo e avisa que a Raquel vai responder. Pode ser assim? Quais são as 10 dúvidas mais comuns? Com as respostas, o bot responde sozinho.
5. Se a pessoa voltar depois de dias ou semanas e escrever só "oi", o bot reenvia o vídeo ou apenas responde de onde parou?
6. Se perguntarem "estou falando com uma pessoa ou com um robô?", o que o bot responde? Sugestão: dizer que é a assistente virtual do Saint Jardin e que a Raquel assume quando for preciso.

### B. Data, ano e convidados

7. Ainda vendemos datas de 2026 (nov e dez)? Se a pessoa disser "dezembro" sem ano, hoje o bot pergunta "2027 ou 2028". E se ela quiser 2026, ou 2029 em diante, o que o bot responde?
8. Se a pessoa disser que ainda não tem data nem ano ("só estou pesquisando valores"), qual proposta o bot manda? Sugestão: perguntar o ano mais provável e mandar essa.
9. Se o evento for para mais de 240 pessoas (limite do salão principal no PDF), o bot avisa que passa da capacidade ou chama a Raquel?
10. Datas ocupadas: o bot hoje responde "a data já está reservada" e oferece a próxima data livre. Quem mantém o calendário de datas ocupadas atualizado? A mensagem pode ser essa?
11. Mini wedding não vale em feriado nem véspera. Se a pessoa pedir uma terça que é véspera de feriado, ela recebe a proposta normal (valor "sábado/feriado/véspera")? Quais feriados contam: só os nacionais ou também os municipais da cidade?
12. Eventos que não são casamento (corporativo, aniversário, formatura, batizado, ensaio): o que o bot responde? Sugestão: avisar que a Raquel vai retornar. Você pensou em um material próprio para corporativo?

### C. Quando a pessoa diz "não" à oferta de mini wedding

13. "Não, prefiro final de semana": o bot manda a proposta normal. Confirmado?
14. "Não, obrigada" ou "não tenho interesse", sem mais nada: o bot encerra com uma despedida cordial e fica quieto, ou pergunta se ela prefere outra data ou final de semana?
15. A pessoa diz "não" ao mini, mas quer o casamento completo em dia de semana (mais de 80 convidados ou não). O bot manda a proposta normal, que já tem os valores de segunda a quinta?
16. A pessoa responde "acho caro" ou "tem desconto?": o bot avisa que a Raquel vai retornar (e a conversa fica com você)?
17. A pessoa pergunta sobre o mini em vez de responder ("quanto é?", "o que inclui?", "tem hospedagem?"): o bot manda o PDF do mini direto, como se fosse um sim? Hoje isso não acontece (o bot não manda o PDF nesse caso).
18. A pessoa responde "talvez", "vou ver com meu noivo", "depende do valor": o bot manda o PDF do mini mesmo assim, ou espera e usa o follow-up?
19. A pessoa não responde a oferta do mini. Deve haver follow-up? O texto que você escreveu fala de "proposta", e nesse ponto ainda não foi enviada nenhuma. Precisamos de um texto para esse caso?

### D. Depois da proposta enviada

20. A pessoa responde "ok", "obrigada", "vou olhar": o bot responde com uma despedida cordial ou fica em silêncio até o follow-up de 12h?
21. O follow-up de 12h vale também quando a pessoa respondeu algo curto (tipo "obrigada")? Ou só quando ela não escreveu nada depois da proposta?
22. Só um follow-up, ou mais um depois (3 dias, 7 dias)? No áudio de julho você falou em cerca de 1 semana e que já tinha uma mensagem pronta para quem "leu e não respondeu". Qual é o texto?
23. Se a pessoa não responder nem o follow-up, o bot encerra de vez ou tenta uma última vez?
24. O follow-up vai como uma única mensagem de 3 parágrafos ou dividida em 2 ou 3 mensagens? Para o mini wedding o texto é o mesmo?
25. Horários do follow-up: janela de envio (sugestão: 8h às 20h)? Se as 12h caírem de madrugada, enviamos às 8h do dia seguinte? Pode ir no domingo?
26. Perguntas comuns depois da proposta ("posso levar meu buffet?", "parcela em mais vezes?", "dá para colocar mais suítes?", "pacote 3 em dia de semana?"): o bot avisa que a Raquel vai responder, certo? Quais delas o bot poderia responder sozinho com o que está nos PDFs?
27. A pessoa pede o valor por texto, "sem PDF": o bot manda só o PDF (como hoje), ou resume os valores "a partir de" na conversa?
28. A pessoa pede outro ano ("e para 2028?") ou outra data: o bot manda a mensagem de ano e o PDF correspondente de novo?
29. Confirmar um valor no PDF 2028: Proposta II, segunda a quinta, está R$58.000, igual ao 2027. É isso mesmo ou deveria subir?

### E. Visita

30. A pessoa aceita a visita ("sim", "quero"): o bot manda "Realizamos visitas de segunda a sexta-feira, em horário comercial, e aos sábados, das 8h às 13h. Que dia ficará melhor?". O que é "horário comercial" exatamente (8h às 18h? tem pausa de almoço)?
31. Se a pessoa pedir um dia fora da regra (domingo, sábado às 15h, feriado), o bot repete as opções de horário e pede outro dia, ou anota e deixa para a Raquel?
32. Se a pessoa der um dia e horário válido, o bot responde "anotei, vou confirmar na agenda e já retorno" e avisa você pelo Telegram. Quanto tempo você leva, em média, para confirmar? Quer um lembrete se ficar parado?
33. Noivos de outra cidade ou estado (destination wedding): oferecemos visita por videochamada? Qual texto?
34. A pessoa recusa a visita ("agora não", "ainda estamos pesquisando"): o bot encerra com despedida cordial. Pode ser uma das 3 mensagens atuais? ("Combinado! Fico à disposição. Se quiser retomar os valores, tirar dúvidas ou marcar uma visita, é só me chamar. 🌿") Quer trocar o texto?

### F. Fornecedor e visita técnica

35. Fornecedor que escreve no primeiro contato (buffet, decorador, imprensa): o bot não manda o vídeo, responde "Entendi! Já te atendo direitinho, só um instante" e chama você. Pode ser assim?
36. Visita técnica: regra atual é terça a sexta e mínimo de 30 dias de antecedência. Continua valendo? Qual o horário?

### G. Cliente que já fechou e a conversa com você

37. Para o bot não responder quem já fechou, preciso da lista (nome, telefone e data do evento) dos clientes fechados. Quem passa e atualiza essa lista? Uma planilha serve?
38. Quando uma conversa vai para você (o bot fica em silêncio), ele volta a atender depois de algum tempo sem mensagens? Por exemplo, a pessoa escreve de novo 30 dias depois. Ou só volta quando você devolver?

### H. Tipos de mensagem e horário

39. Se a pessoa mandar foto, figurinha ou PDF, o bot hoje responde "Por aqui só consigo entender texto e áudio. Pode me responder em texto?". Em foto de inspiração de casamento, isso é bom ou prefere que chame você?
40. O bot responde a qualquer hora (com cerca de 1 minuto de espera) ou só em horário comercial? E os alertas para você, ficam ligados à noite?

---

## Parte 2. Cenários e o que o bot faz hoje

### O "não" em cada ponto da conversa

Código em `src/domain/stateMachine.ts`.

| Onde a pessoa está | Ela diz | Hoje o bot faz | Pergunta relacionada |
|---|---|---|---|
| Qualificação (data, convidados) | "não sei ainda" | Pede de novo o que falta (3 variações) | 7, 8 |
| Oferta do mini | "sim" / manda uma data | Manda anúncio + PDF mini + convite de visita | decidido |
| Oferta do mini | "não" seco | Encerra com despedida (3 variações), fica quieta | 13, 14, 15 |
| Oferta do mini | "não, quero final de semana" | Re-qualifica e manda proposta normal | 13 |
| Oferta do mini | pergunta ("quanto é?") | Não manda PDF; manda convite de visita | 17 |
| Oferta do mini | "talvez" / "vou ver" | Manda convite de visita | 18 |
| Oferta do mini | silêncio | Nada (sem follow-up) | 19 |
| Proposta enviada | "não" | Encerra com despedida | 20 |
| Proposta enviada | "ok", "obrigada" | Um "ok" pode ser lido como "sim" ao convite e disparar a pergunta de visita | 20, ver abaixo |
| Proposta enviada | "acho caro", "tem desconto" | Passa para a Raquel em silêncio | 16, 26 |
| Proposta enviada | silêncio | Nada hoje. Novo: follow-up de 12h | 21 a 25 |
| Pergunta de visita | "não" | Encerra com despedida | 34 |
| Pergunta de visita | dia e horário | "Anotei, vou confirmar" + avisa a Raquel | 30 a 32 |
| Encerrada | volta com dados novos ou pede visita | Reabre | 38 |

### Mudança de lógica que o novo fluxo força

Hoje, em `proposta_enviada`, um "sim" ou "ok" vale como aceite do convite de visita, porque o bot
sempre manda o convite junto da proposta. Sem o convite imediato, um "ok, obrigada" logo depois do
PDF viraria pergunta de visita sem ninguém ter convidado. Proposta: o aceite por afirmativo só vale
**depois que o follow-up foi enviado**. Antes disso, só vale pedido explícito de visita ("quero
conhecer", "posso visitar?").

### Follow-up de 12h: o que é

É a mensagem 1.7 do material (`Oie! Ficou alguma dúvida sobre nossa proposta?...`). O bot manda uma
vez, quando passaram 12h do envio da proposta e a pessoa não escreveu nada depois. Ela faz o papel
do convite de visita que antes saía junto do PDF. Regras propostas:

- Só em `proposta_enviada`. Nunca em handoff, humano ou encerrada.
- Uma vez por conversa (até a Raquel definir mais).
- Janela de envio fora da madrugada. Se as 12h caírem fora dela, espera abrir a janela.
- Só dentro de 24h da última mensagem da pessoa (limite da Meta para mensagem livre).
- Depois dele, "sim" ou "quero" vira o fluxo de visita.
