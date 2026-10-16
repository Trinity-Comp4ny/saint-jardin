import { describe, expect, it } from 'vitest';
import {
  conviteDevido,
  dentroDaJanelaDeEnvio,
  followupDevido,
  horaEmBrasilia,
  retomadaDevida,
} from '../src/domain/followup';
import { processarFollowups } from '../src/app/followup';
import { processarMensagem, type Deps } from '../src/app/orchestrator';
import { MSG } from '../src/domain/persona';
import {
  InMemoryContatoRepo,
  InMemoryConversaRepo,
  InMemoryMensagemRepo,
  MockCalendario,
  RecordingNotifier,
  SandboxProvider,
} from '../src/adapters/memory';
import { MockNLU } from '../src/adapters/MockNLU';
import { novaConversa } from '../src/domain/stateMachine';
import type { Conversa } from '../src/domain/types';
import type { NLU } from '../src/ports';

// Brasília é UTC-3: 15:00Z = 12:00 BRT.
const PROPOSTA = '2026-10-14T15:00:00.000Z'; // 12:00 BRT
const mais = (iso: string, horas: number) =>
  new Date(new Date(iso).getTime() + horas * 3_600_000).toISOString();

function conversaProposta(extra: Partial<Conversa> = {}): Conversa {
  return {
    ...novaConversa('5511999', PROPOSTA),
    estado: 'proposta_enviada',
    propostaEnviadaEm: PROPOSTA,
    ultimaEntradaEm: PROPOSTA,
    conviteEnviadoEm: PROPOSTA, // o convite de 5 min é testado à parte; aqui vale o follow-up de 12h
    ...extra,
  };
}

describe('janela de envio (horário de Brasília)', () => {
  it('converte UTC para a hora de Brasília', () => {
    expect(horaEmBrasilia('2026-10-14T11:00:00.000Z')).toBe(8);
    expect(horaEmBrasilia('2026-10-14T02:59:00.000Z')).toBe(23); // 23:59 BRT do dia anterior
  });

  it('vale das 8h às 20h, sem incluir as 20h', () => {
    expect(dentroDaJanelaDeEnvio('2026-10-14T10:59:00.000Z')).toBe(false); // 07:59
    expect(dentroDaJanelaDeEnvio('2026-10-14T11:00:00.000Z')).toBe(true); // 08:00
    expect(dentroDaJanelaDeEnvio('2026-10-14T22:59:00.000Z')).toBe(true); // 19:59
    expect(dentroDaJanelaDeEnvio('2026-10-14T23:00:00.000Z')).toBe(false); // 20:00
  });
});

describe('followupDevido', () => {
  it('espera as 12h: antes disso não é devido', () => {
    expect(followupDevido(conversaProposta(), mais(PROPOSTA, 11.9))).toBe(false);
  });

  it('com 12h e a pessoa em silêncio, dentro da janela: devido', () => {
    // proposta 12:00 BRT -> 12h depois = 00:00 BRT (madrugada), então testamos às 08:00 do dia seguinte.
    expect(followupDevido(conversaProposta(), mais(PROPOSTA, 20))).toBe(true); // 08:00 BRT
  });

  it('de madrugada não é devido, mesmo passadas as 12h', () => {
    expect(followupDevido(conversaProposta(), mais(PROPOSTA, 12))).toBe(false); // 00:00 BRT
    expect(followupDevido(conversaProposta(), mais(PROPOSTA, 18))).toBe(false); // 06:00 BRT
  });

  it('proposta às 9h: as 12h caem às 21h (fora da janela) e o envio espera as 8h do dia seguinte', () => {
    const manha = '2026-10-14T12:00:00.000Z'; // 09:00 BRT
    const c = conversaProposta({ propostaEnviadaEm: manha, ultimaEntradaEm: manha });
    expect(followupDevido(c, mais(manha, 12))).toBe(false); // 21:00 BRT
    expect(followupDevido(c, mais(manha, 23))).toBe(true); // 08:00 BRT do dia seguinte, 23h depois
  });

  it('passou de 23h30 da proposta: o texto livre da Meta já não é permitido, não é devido', () => {
    expect(followupDevido(conversaProposta(), mais(PROPOSTA, 24))).toBe(false);
  });

  it('se a pessoa escreveu depois da proposta, cancela', () => {
    const c = conversaProposta({ ultimaEntradaEm: mais(PROPOSTA, 2) });
    expect(followupDevido(c, mais(PROPOSTA, 20))).toBe(false);
  });

  it('só uma vez por proposta', () => {
    const c = conversaProposta({ followupEnviadoEm: mais(PROPOSTA, 20) });
    expect(followupDevido(c, mais(PROPOSTA, 21))).toBe(false);
  });

  it('só em proposta_enviada', () => {
    for (const estado of ['handoff', 'humano', 'encerrada', 'aguardando_pref_visita'] as const) {
      expect(followupDevido(conversaProposta({ estado }), mais(PROPOSTA, 20))).toBe(false);
    }
  });

  it('conversa sem data de proposta (anterior à migration) não é devida', () => {
    expect(followupDevido(conversaProposta({ propostaEnviadaEm: undefined }), mais(PROPOSTA, 20))).toBe(false);
  });
});

describe('processarFollowups', () => {
  let conversas: InMemoryConversaRepo;
  let messaging: SandboxProvider;
  let mensagens: InMemoryMensagemRepo;
  let agoraAtual: string;
  let deps: Deps;

  const montar = () => {
    conversas = new InMemoryConversaRepo();
    messaging = new SandboxProvider();
    mensagens = new InMemoryMensagemRepo();
    agoraAtual = mais(PROPOSTA, 20); // 08:00 BRT do dia seguinte
    deps = {
      contatos: new InMemoryContatoRepo(),
      conversas,
      nlu: new MockNLU(),
      calendario: new MockCalendario(),
      messaging,
      notifier: new RecordingNotifier(),
      mensagens,
      agora: () => agoraAtual,
    };
  };

  it('envia o texto da Raquel e marca o follow-up como enviado', async () => {
    montar();
    await conversas.salvar(conversaProposta());
    expect(await processarFollowups(deps)).toBe(1);
    expect(messaging.enviadas).toHaveLength(1);
    expect(messaging.enviadas[0]?.saidas[0]?.texto).toBe(MSG.followUp);
    expect(messaging.enviadas[0]?.saidas[0]?.texto).toMatch(/^Oie! Ficou alguma dúvida sobre nossa proposta/);
    expect((await conversas.obter('5511999'))?.followupEnviadoEm).toBe(agoraAtual);
    expect(await mensagens.historico('5511999', 5)).toHaveLength(1);
  });

  it('é idempotente: um segundo ciclo do cron não reenvia', async () => {
    montar();
    await conversas.salvar(conversaProposta());
    await processarFollowups(deps);
    expect(await processarFollowups(deps)).toBe(0);
    expect(messaging.enviadas).toHaveLength(1);
  });

  it('fora da janela de horário não envia nada', async () => {
    montar();
    await conversas.salvar(conversaProposta());
    agoraAtual = mais(PROPOSTA, 18); // 06:00 BRT
    expect(await processarFollowups(deps)).toBe(0);
    expect(messaging.enviadas).toHaveLength(0);
  });

  it('não envia para quem respondeu depois da proposta', async () => {
    montar();
    await conversas.salvar(conversaProposta({ ultimaEntradaEm: mais(PROPOSTA, 3) }));
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('não envia para conversa que passou para a Raquel', async () => {
    montar();
    await conversas.salvar(conversaProposta({ estado: 'handoff' }));
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('se o envio falha, libera para o próximo ciclo tentar de novo', async () => {
    montar();
    await conversas.salvar(conversaProposta());
    const original = messaging.enviar.bind(messaging);
    let falhar = true;
    messaging.enviar = async (tel, saidas) => {
      if (falhar) throw new Error('Cloud API 500');
      return original(tel, saidas);
    };
    expect(await processarFollowups(deps)).toBe(0);
    expect((await conversas.obter('5511999'))?.followupEnviadoEm).toBeUndefined();
    falhar = false;
    expect(await processarFollowups(deps)).toBe(1);
  });
});

describe('follow-up ponta a ponta com o orquestrador', () => {
  const NOIVA = '5511988887777';

  function montarFluxo(): { deps: Deps; relogio: { agora: string }; messaging: SandboxProvider } {
    const relogio = { agora: PROPOSTA };
    const messaging = new SandboxProvider();
    const deps: Deps = {
      contatos: new InMemoryContatoRepo(),
      conversas: new InMemoryConversaRepo(),
      nlu: new MockNLU(),
      calendario: new MockCalendario(),
      messaging,
      notifier: new RecordingNotifier(),
      mensagens: new InMemoryMensagemRepo(),
      agora: () => relogio.agora,
    };
    return { deps, relogio, messaging };
  }

  it('proposta enviada, silêncio por 12h: follow-up; "sim" depois dele leva à visita', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('proposta_enviada');

    relogio.agora = mais(PROPOSTA, 20);
    expect(await processarFollowups(deps)).toBe(1);
    expect(messaging.enviadas.at(-1)?.saidas[0]?.texto).toBe(MSG.followUp);

    relogio.agora = mais(PROPOSTA, 21);
    const r = await processarMensagem(NOIVA, 'sim, quero', deps);
    expect(r.conversa.estado).toBe('aguardando_pref_visita');
    expect(r.saidas[0]?.texto).toMatch(/Realizamos visitas de segunda a sexta-feira/);
  });

  it('se a noiva responde antes das 12h, o follow-up não sai', async () => {
    const { deps, relogio } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);

    relogio.agora = mais(PROPOSTA, 2);
    await processarMensagem(NOIVA, 'obrigada, vou olhar', deps);

    relogio.agora = mais(PROPOSTA, 20);
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('uma proposta nova (outro ano) reinicia a contagem do follow-up', async () => {
    const { deps, relogio } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    const depois = mais(PROPOSTA, 1);
    relogio.agora = depois;
    await processarMensagem(NOIVA, 'e para 2028?', deps);
    const c = await deps.conversas.obter(NOIVA);
    expect(c?.estado).toBe('proposta_enviada');
    expect(c?.propostaEnviadaEm).toBe(depois);
    expect(c?.followupEnviadoEm).toBeUndefined();
  });
});

describe('retomadaDevida: quem parou de responder antes da proposta', () => {
  const PERGUNTA = PROPOSTA; // última mensagem da pessoa, 12:00 BRT
  const emQualificacao = (extra: Partial<Conversa> = {}): Conversa => ({
    ...novaConversa('5511999', PERGUNTA),
    estado: 'aguardando_qualificacao',
    ultimaEntradaEm: PERGUNTA,
    ...extra,
  });

  it('com 12h de silêncio, dentro da janela de horário: devida', () => {
    expect(retomadaDevida(emQualificacao(), mais(PERGUNTA, 20))).toBe(true); // 08:00 BRT do dia seguinte
  });

  it('antes das 12h, de madrugada ou depois de 23h30: não é devida', () => {
    expect(retomadaDevida(emQualificacao(), mais(PERGUNTA, 11.9))).toBe(false);
    expect(retomadaDevida(emQualificacao(), mais(PERGUNTA, 12))).toBe(false); // 00:00 BRT
    expect(retomadaDevida(emQualificacao(), mais(PERGUNTA, 24))).toBe(false); // passou das 24h da Meta
  });

  it('só uma vez', () => {
    expect(retomadaDevida(emQualificacao({ followupEnviadoEm: mais(PERGUNTA, 20) }), mais(PERGUNTA, 21))).toBe(false);
  });

  it('só em aguardando_qualificacao', () => {
    for (const estado of [
      'novo',
      'aguardando_assunto',
      'aguardando_interesse_mini',
      'aguardando_aceite_tradicional',
      'aguardando_pref_visita',
      'proposta_enviada',
      'encerrada',
      'handoff',
      'humano',
    ] as const) {
      expect(retomadaDevida(emQualificacao({ estado }), mais(PERGUNTA, 20))).toBe(false);
    }
  });

  it('sem data da última mensagem da pessoa não é devida', () => {
    expect(retomadaDevida(emQualificacao({ ultimaEntradaEm: undefined }), mais(PERGUNTA, 20))).toBe(false);
  });
});

describe('retomada do orçamento ponta a ponta', () => {
  const NOIVA = '5511988887777';

  // O MockNLU não marca `negativo`; este envelope faz o papel do Gemini para "não...".
  const mock = new MockNLU();
  const nluComNegativa: NLU = {
    async analisar(texto, conversa) {
      const r = await mock.analisar(texto, conversa);
      return /^n[ãa]o\b/i.test(texto) ? { ...r, negativo: true } : r;
    },
  };

  function montarFluxo() {
    const relogio = { agora: PROPOSTA };
    const messaging = new SandboxProvider();
    const deps: Deps = {
      contatos: new InMemoryContatoRepo(),
      conversas: new InMemoryConversaRepo(),
      nlu: nluComNegativa,
      calendario: new MockCalendario(),
      messaging,
      notifier: new RecordingNotifier(),
      mensagens: new InMemoryMensagemRepo(),
      agora: () => relogio.agora,
    };
    return { deps, relogio, messaging };
  }
  const textos = (m: SandboxProvider) => m.enviadas.flatMap((e) => e.saidas).map((s) => s.texto);

  it('pediu orçamento e sumiu: 12h depois recebe a retomada, uma vez só', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('aguardando_qualificacao');

    relogio.agora = mais(PROPOSTA, 20); // 08:00 BRT do dia seguinte
    expect(await processarFollowups(deps)).toBe(1);
    expect(textos(messaging).at(-1)).toBe('Oi, gostaria de retomar o orçamento?');
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('respondeu "sim": segue pedindo o que falta', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    relogio.agora = mais(PROPOSTA, 20);
    await processarFollowups(deps);

    await processarMensagem(NOIVA, 'sim', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('aguardando_qualificacao');
    expect(textos(messaging).at(-1)).toMatch(/orçamento/);
    expect(textos(messaging).at(-1)).not.toBe(MSG.retomarOrcamento);
  });

  it('respondeu "não": encerra com cordialidade, sem pedir os dados de novo', async () => {
    const { deps, relogio } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    relogio.agora = mais(PROPOSTA, 20);
    await processarFollowups(deps);

    await processarMensagem(NOIVA, 'não, obrigada', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('encerrada');
  });

  it('um "não" sem retomada continua pedindo os dados (regra antiga)', async () => {
    const { deps } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'não', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('aguardando_qualificacao');
  });

  it('depois da retomada ela completa os dados: a proposta sai e o follow-up da proposta segue valendo', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    relogio.agora = mais(PROPOSTA, 20);
    await processarFollowups(deps);

    relogio.agora = mais(PROPOSTA, 21);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    expect((await deps.conversas.obter(NOIVA))?.estado).toBe('proposta_enviada');
    expect((await deps.conversas.obter(NOIVA))?.followupEnviadoEm).toBeUndefined();

    relogio.agora = mais(PROPOSTA, 21 + 23); // proposta às 09:00 BRT: o follow-up espera as 08:00 do dia seguinte
    expect(await processarFollowups(deps)).toBe(1);
    expect(textos(messaging).at(-1)).toBe(MSG.followUp);
  });

  it('quem respondeu entre a consulta e o envio não recebe (reivindicação atômica)', async () => {
    const conversas = new InMemoryConversaRepo();
    const ate = mais(PROPOSTA, 8); // limite: a pessoa deve estar em silêncio desde antes disso
    await conversas.salvar({
      ...novaConversa('5511999', PROPOSTA),
      estado: 'aguardando_qualificacao',
      ultimaEntradaEm: mais(PROPOSTA, 9), // escreveu depois do limite
    });
    expect(await conversas.reivindicarRetomada('5511999', mais(PROPOSTA, 20), ate)).toBe(false);
  });

  it('o ciclo manda as duas: retomada para uma conversa e follow-up da proposta para outra', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem('5511911111111', 'queria um orçamento', deps);
    await processarMensagem('5511922222222', 'queria um orçamento', deps);
    await processarMensagem('5511922222222', 'sábado, 200 pessoas em 2027', deps);

    relogio.agora = mais(PROPOSTA, 20);
    expect(await processarFollowups(deps)).toBe(2);
    const enviados = messaging.enviadas.slice(-2).map((e) => e.saidas[0]?.texto);
    expect(enviados).toContain(MSG.retomarOrcamento);
    expect(enviados).toContain(MSG.followUp);
  });
});

describe('conviteDevido: "O que acharam da proposta?" 5 minutos depois do PDF', () => {
  // proposta às 12:00 BRT; 5 min depois = 12:05 BRT, dentro da janela de envio
  const pendente = (extra: Partial<Conversa> = {}): Conversa => ({
    ...novaConversa('5511999', PROPOSTA),
    estado: 'proposta_enviada',
    propostaEnviadaEm: PROPOSTA,
    ultimaEntradaEm: PROPOSTA,
    ...extra,
  });
  const minutos = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

  it('com 5 minutos de silêncio: devido. Antes disso, não', () => {
    expect(conviteDevido(pendente(), minutos(PROPOSTA, 4.9))).toBe(false);
    expect(conviteDevido(pendente(), minutos(PROPOSTA, 5))).toBe(true);
  });

  it('se a pessoa escreveu depois da proposta, não é devido (o convite vai junto da resposta do bot)', () => {
    expect(conviteDevido(pendente({ ultimaEntradaEm: minutos(PROPOSTA, 2) }), minutos(PROPOSTA, 6))).toBe(false);
  });

  it('só uma vez', () => {
    expect(conviteDevido(pendente({ conviteEnviadoEm: minutos(PROPOSTA, 5) }), minutos(PROPOSTA, 6))).toBe(false);
  });

  it('só em proposta_enviada', () => {
    for (const estado of ['handoff', 'humano', 'encerrada', 'aguardando_pref_visita', 'aguardando_qualificacao'] as const) {
      expect(conviteDevido(pendente({ estado }), minutos(PROPOSTA, 6))).toBe(false);
    }
  });

  it('fora da janela das 8h às 20h não sai, e depois de 30 minutos também não (o follow-up de 12h cobre)', () => {
    const noite = '2026-10-14T22:58:00.000Z'; // 19:58 BRT
    const c = pendente({ propostaEnviadaEm: noite, ultimaEntradaEm: noite });
    expect(conviteDevido(c, minutos(noite, 5))).toBe(false); // 20:03 BRT, fora da janela
    expect(conviteDevido(c, minutos(noite, 12 * 60 + 2))).toBe(false); // 08:00 do dia seguinte: o follow-up de 12h
    expect(conviteDevido(pendente(), minutos(PROPOSTA, 31))).toBe(false); // cron parado: não manda atrasado
    expect(conviteDevido(pendente(), minutos(PROPOSTA, 30))).toBe(true);
  });
});

describe('convite de visita ponta a ponta', () => {
  const NOIVA = '5511988887777';
  const minutos = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60_000).toISOString();

  function montarFluxo() {
    const relogio = { agora: PROPOSTA };
    const messaging = new SandboxProvider();
    const deps: Deps = {
      contatos: new InMemoryContatoRepo(),
      conversas: new InMemoryConversaRepo(),
      nlu: new MockNLU(),
      calendario: new MockCalendario(),
      messaging,
      notifier: new RecordingNotifier(),
      mensagens: new InMemoryMensagemRepo(),
      agora: () => relogio.agora,
    };
    return { deps, relogio, messaging };
  }
  const textos = (m: SandboxProvider) => m.enviadas.flatMap((e) => e.saidas).map((s) => s.texto);

  it('a proposta sai sem o convite; 5 minutos depois o job manda, uma vez só', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    expect(textos(messaging)).not.toContain(MSG.conviteVisitaPosProposta);

    relogio.agora = minutos(PROPOSTA, 3);
    expect(await processarFollowups(deps)).toBe(0); // ainda não deu 5 minutos

    relogio.agora = minutos(PROPOSTA, 5);
    expect(await processarFollowups(deps)).toBe(1);
    expect(textos(messaging).at(-1)).toBe(MSG.conviteVisitaPosProposta);
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('respondeu em 2 minutos ("adorei!"): o convite vem junto da resposta e o job não repete', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);

    relogio.agora = minutos(PROPOSTA, 2);
    await processarMensagem(NOIVA, 'adorei', deps);
    expect(textos(messaging).at(-1)).toBe(MSG.conviteVisitaPosProposta);

    relogio.agora = minutos(PROPOSTA, 6);
    expect(await processarFollowups(deps)).toBe(0);
  });

  it('depois do convite de 5 min, o follow-up de 12h segue valendo', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    relogio.agora = minutos(PROPOSTA, 5);
    await processarFollowups(deps);

    relogio.agora = mais(PROPOSTA, 20); // 08:00 BRT do dia seguinte
    expect(await processarFollowups(deps)).toBe(1);
    expect(textos(messaging).at(-1)).toBe(MSG.followUp);
  });

  it('se o envio do convite falha, libera para o próximo ciclo tentar de novo', async () => {
    const { deps, relogio, messaging } = montarFluxo();
    await processarMensagem(NOIVA, 'queria um orçamento', deps);
    await processarMensagem(NOIVA, 'sábado, 200 pessoas em 2027', deps);
    const original = messaging.enviar.bind(messaging);
    let falhar = true;
    messaging.enviar = async (tel, saidas) => {
      if (falhar) throw new Error('Cloud API 500');
      return original(tel, saidas);
    };
    relogio.agora = minutos(PROPOSTA, 5);
    expect(await processarFollowups(deps)).toBe(0);
    falhar = false;
    expect(await processarFollowups(deps)).toBe(1);
  });

  it('quem escreveu entre a consulta e o envio não recebe (reivindicação atômica)', async () => {
    const conversas = new InMemoryConversaRepo();
    await conversas.salvar({
      ...novaConversa('5511999', PROPOSTA),
      estado: 'proposta_enviada',
      propostaEnviadaEm: PROPOSTA,
      ultimaEntradaEm: minutos(PROPOSTA, 3), // escreveu depois da proposta
    });
    expect(await conversas.reivindicarConvite('5511999', minutos(PROPOSTA, 5), PROPOSTA)).toBe(false);
  });
});
