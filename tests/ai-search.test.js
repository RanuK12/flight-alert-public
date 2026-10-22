'use strict';

const ai = require('../src/services/ai');
const { validate } = require('../src/services/ai/schema');
const { parseRules } = require('../src/services/ai/rules');
const providers = require('../src/services/ai/providers');

const P = [{ name: 'groq' }, { name: 'mistral' }];
const good = JSON.stringify({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10', returnDate: null, adults: 2 });
const pro = async () => true;
const free = async () => false;

beforeEach(() => {
  require('../src/utils/clock').setNow(new Date('2026-10-22T12:00:00Z'));
  delete process.env.GROQ_MODEL;
  ai._reset();
  process.env.AI_ENABLED = 'true';
  delete process.env.ADMIN_TELEGRAM_IDS;
  delete process.env.OWNER_TELEGRAM_IDS;
});
afterAll(() => { delete process.env.AI_ENABLED; });

describe('schema', () => {
  test('acepta un JSON válido', () => {
    expect(validate(JSON.parse(good)).ok).toBe(true);
  });
  test('rechaza IATA fuera de la lista, fechas inválidas y claves extra (precios)', () => {
    expect(validate({ origin: 'JFK', destination: 'MAD', departDate: '2026-12-10' }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-02-30' }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10', price: 500 }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10', returnDate: '2026-12-01' }).ok).toBe(false);
  });
});

test('rules parser', () => {
  expect(parseRules('eze mad 2026-12-10 2027-01-05 2 adultos')).toMatchObject({ origin: 'EZE', destination: 'MAD', returnDate: '2027-01-05', adults: 2 });
  expect(parseRules('quiero ir a madrid en diciembre')).toBeNull();
});

test('las reglas resuelven sin llamar a la IA', async () => {
  const call = jest.fn();
  const out = await ai.parse(1, 'COR MAD 2026-12-10', { call, providers: P, isPro: free });
  expect(out).toMatchObject({ ok: true, source: 'rules' });
  expect(call).not.toHaveBeenCalled();
});

test('kill switch: AI_ENABLED off por defecto', async () => {
  delete process.env.AI_ENABLED;
  const call = jest.fn();
  const out = await ai.parse(1, 'córdoba a madrid el 10 de diciembre', { call, providers: P, isPro: pro });
  expect(out.reason).toBe('disabled');
  expect(call).not.toHaveBeenCalled();
});

test('solo Pro o admin', async () => {
  const call = jest.fn(async () => ({ content: good, tokens: 10 }));
  expect((await ai.parse(1, 'córdoba a madrid', { call, providers: P, isPro: free })).reason).toBe('not_pro');
  process.env.ADMIN_TELEGRAM_IDS = '777';
  expect((await ai.parse(777, 'córdoba a madrid', { call, providers: P, isPro: free })).ok).toBe(true);
});

test('Groq primario, Mistral fallback, con max_tokens <= 150', async () => {
  const call = jest.fn(async (p, _m, o) => {
    expect(o.maxTokens).toBeLessThanOrEqual(150);
    if (p.name === 'groq') { const e = new Error('x'); e.status = 503; throw e; }
    return { content: good, tokens: 42 };
  });
  const out = await ai.parse(1, 'córdoba a madrid 10 dic', { call, providers: P, isPro: pro });
  expect(out).toMatchObject({ ok: true, source: 'ai', value: { origin: 'COR', destination: 'MAD', adults: 2 } });
  expect(call.mock.calls.map((c) => c[0].name)).toEqual(['groq', 'mistral']);
  const h = ai.health();
  expect(h).toMatchObject({ calls: 2, tokens: 42, errors: 1, fallbacks: 1 });
});

test('la IA nunca aporta precios: respuesta con precio se rechaza', async () => {
  const call = jest.fn(async () => ({ content: JSON.stringify({ ...JSON.parse(good), price: 300 }), tokens: 5 }));
  const out = await ai.parse(1, 'cor a mad barato', { call, providers: P, isPro: pro });
  expect(out.ok).toBe(false);
});

test('cache por texto normalizado', async () => {
  const call = jest.fn(async () => ({ content: good, tokens: 5 }));
  await ai.parse(1, 'Córdoba a  Madrid', { call, providers: P, isPro: pro });
  const again = await ai.parse(1, '  córdoba A madrid ', { call, providers: P, isPro: pro });
  expect(again.source).toBe('cache');
  expect(call).toHaveBeenCalledTimes(1);
});

test('tope de 20 llamadas por día por usuario', async () => {
  const call = jest.fn(async () => ({ content: good, tokens: 1 }));
  for (let i = 0; i < 20; i += 1) {
    expect((await ai.parse(5, `viaje ${i}`, { call, providers: P, isPro: pro })).ok).toBe(true);
  }
  expect((await ai.parse(5, 'viaje 21', { call, providers: P, isPro: pro })).reason).toBe('daily_cap');
  expect(ai.health().capped).toBe(1);
});

test('providers: temperature 0, max_tokens tope y timeout', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const fetchImpl = jest.fn(async (_u, init) => {
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(150);
    expect(init.signal).toBeDefined();
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: good } }], usage: { total_tokens: 9 } }) };
  });
  const out = await providers.callOne(providers.PROVIDERS[0], [], { maxTokens: 999, fetchImpl });
  expect(out).toMatchObject({ provider: 'groq', tokens: 9 });
  expect(providers.PROVIDERS.map((p) => p.model)).toEqual(['openai/gpt-oss-20b', 'mistral-small-latest']);
  delete process.env.GROQ_API_KEY;
});
