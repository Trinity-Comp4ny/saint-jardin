import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseWebhook } from '../src/whatsapp/parseWebhook';
import { assinaturaValida, verificarHandshake } from '../src/whatsapp/verifySignature';
import { adiarISO } from '../src/app/pipeline';

function webhookTexto(id: string, from: string, body: string): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messages: [{ id, from, type: 'text', text: { body }, timestamp: '1700000000' }],
            },
          },
        ],
      },
    ],
  };
}

describe('parseWebhook', () => {
  it('extrai mensagem de texto', () => {
    const msgs = parseWebhook(webhookTexto('wamid.1', '5511988887777', 'oi quero orçamento'));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      messageId: 'wamid.1',
      de: '5511988887777',
      tipo: 'texto',
      texto: 'oi quero orçamento',
    });
  });

  it('extrai áudio com mediaId', () => {
    const body = {
      entry: [
        { changes: [{ value: { messages: [{ id: 'wamid.2', from: '5511', type: 'audio', audio: { id: 'media-9' } }] } }] },
      ],
    };
    const msgs = parseWebhook(body);
    expect(msgs[0]).toMatchObject({ tipo: 'audio', mediaId: 'media-9' });
  });

  it('ignora eventos que não são mensagens (status de entrega)', () => {
    const body = { entry: [{ changes: [{ value: { statuses: [{ id: 'x', status: 'delivered' }] } }] }] };
    expect(parseWebhook(body)).toHaveLength(0);
  });

  it('não quebra com payload malformado', () => {
    expect(parseWebhook(null)).toEqual([]);
    expect(parseWebhook({})).toEqual([]);
    expect(parseWebhook({ entry: 'nope' })).toEqual([]);
  });
});

describe('verificarHandshake', () => {
  it('devolve o challenge quando o token bate', () => {
    const p = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'segredo',
      'hub.challenge': '12345',
    });
    expect(verificarHandshake(p, 'segredo')).toBe('12345');
  });

  it('rejeita token errado', () => {
    const p = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'errado',
      'hub.challenge': '12345',
    });
    expect(verificarHandshake(p, 'segredo')).toBeNull();
  });
});

describe('assinaturaValida', () => {
  const secret = 'app-secret';
  const corpo = '{"hello":"world"}';
  const assinatura = 'sha256=' + createHmac('sha256', secret).update(corpo, 'utf8').digest('hex');

  it('aceita assinatura correta', () => {
    expect(assinaturaValida(corpo, assinatura, secret)).toBe(true);
  });

  it('rejeita assinatura adulterada', () => {
    expect(assinaturaValida(corpo + 'x', assinatura, secret)).toBe(false);
    expect(assinaturaValida(corpo, 'sha256=deadbeef', secret)).toBe(false);
    expect(assinaturaValida(corpo, null, secret)).toBe(false);
  });
});

describe('adiarISO', () => {
  it('soma segundos ao instante (delay proposital)', () => {
    expect(adiarISO('2026-07-21T12:00:00.000Z', 60)).toBe('2026-07-21T12:01:00.000Z');
  });
});
