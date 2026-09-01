// Regressão de segurança: sem os secrets do WhatsApp configurados, as rotas
// tinham fallback para string vazia ("" as any secret), o que tornava a
// assinatura/verify_token PREVISÍVEIS (qualquer um calcula HMAC de um segredo
// vazio). As rotas devem falhar FECHADO (rejeitar) quando o secret não existe,
// nunca aceitar com um segredo "adivinhável".
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { GET, POST } from '../app/api/whatsapp/route';
import { numeroEnv } from '../src/app/pipeline';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/whatsapp — falha fechado sem WHATSAPP_APP_SECRET', () => {
  it('rejeita mesmo com a assinatura calculada com segredo vazio (o que um atacante conseguiria replicar)', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    const corpo = '{"entry":[]}';
    const assinaturaDeSegredoVazio =
      'sha256=' + createHmac('sha256', '').update(corpo, 'utf8').digest('hex');

    const resp = await POST(
      new Request('http://localhost/api/whatsapp', {
        method: 'POST',
        headers: { 'x-hub-signature-256': assinaturaDeSegredoVazio },
        body: corpo,
      }),
    );

    expect(resp.status).toBe(401);
  });

  it('rejeita quando a env var nem existe (undefined)', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', undefined as unknown as string);
    const resp = await POST(
      new Request('http://localhost/api/whatsapp', { method: 'POST', body: '{}' }),
    );
    expect(resp.status).toBe(401);
  });
});

describe('GET /api/whatsapp — falha fechado sem WHATSAPP_VERIFY_TOKEN', () => {
  it('rejeita o handshake mesmo com hub.verify_token vazio batendo um fallback vazio', async () => {
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', '');
    const url = 'http://localhost/api/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=123';
    const resp = await GET(new Request(url));
    expect(resp.status).toBe(403);
  });
});

describe('numeroEnv — regressão: env var vazia ou inválida não pode virar 0/NaN silencioso', () => {
  it('usa o default quando a env var não existe', () => {
    expect(numeroEnv(undefined, 30)).toBe(30);
  });

  it('usa o default quando a env var está vazia (RATE_LIMIT_MAX_MENSAGENS="" bloqueava todo mundo)', () => {
    expect(numeroEnv('', 30)).toBe(30);
  });

  it('usa o default quando a env var não é um número (typo desligava o rate limit)', () => {
    expect(numeroEnv('abc', 30)).toBe(30);
  });

  it('usa o valor configurado quando é um número válido', () => {
    expect(numeroEnv('15', 30)).toBe(15);
  });

  it('aceita 0 explícito como valor válido (diferente de "" vazio)', () => {
    // 0 é um número válido escolhido de propósito (ex.: JITTER_SEGUNDOS=0);
    // só "" e valores não numéricos devem cair no default, não o número 0.
    expect(numeroEnv('0', 30)).toBe(0);
  });
});
