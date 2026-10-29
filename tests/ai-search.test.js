'use strict';

const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const clock = require('../src/utils/clock');
const ai = require('../src/services/ai');
const quota = require('../src/services/ai/quota');
const { validate, fromLlm } = require('../src/services/ai/schema');
const { parseRules } = require('../src/services/ai/rules');
const providers = require('../src/services/ai/providers');

const good = JSON.stringify({ origen: 'COR', destino: 'MAD', fecha_ida: '2026-12-10', fecha_vuelta: null, flex_dias: 0 });
const pro = async () => true;
const free = async () => false;

beforeEach(() => {
  cleanEnv(); reset(); ai._reset();
  clock.setNow(new Date('2026-10-22T12:00:00Z'));
  delete process.env.GROQ_MODEL;
  process.env.AI_ENABLED = 'true';
  process.env.GROQ_API_KEY = 'test-groq';
  process.env.MISTRAL_API_KEY = 'test-mistral';
});
afterAll(() => {
  clock.reset();
  for (const k of ['AI_ENABLED', 'GROQ_API_KEY', 'MISTRAL_API_KEY']) delete process.env[k];
});

describe('schema (reglas, regla de oro: la IA no ejecuta nada)', () => {
  test('validate: acepta JSON válido, rechaza IATA fuera de la lista, fechas inválidas y claves extra', () => {
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10' }).ok).toBe(true);
    expect(validate({ origin: 'JFK', destination: 'MAD', departDate: '2026-12-10' }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-02-30' }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10', price: 500 }).ok).toBe(false);
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-12-10', returnDate: '2026-12-01' }).ok).toBe(false);
  });

  const today = '2026-10-22';
  const ok = { origen: 'COR', destino: 'MAD', fecha_ida: '2026-12-10', fecha_vuelta: '2026-12-24', flex_dias: 3 };

  test('fromLlm: salida válida del contrato', () => {
    expect(fromLlm(ok, { today })).toEqual({
      ok: true,
      value: { origin: 'COR', destination: 'MAD', departDate: '2026-12-10', returnDate: '2026-12-24', adults: 1, flexDays: 3 },
    });
    expect(fromLlm({ ...ok, fecha_vuelta: null, flex_dias: null }, { today }).value).toMatchObject({ returnDate: null, flexDays: 0 });
    expect(fromLlm({ ...ok, origen: 'cor' }, { today }).ok).toBe(true);
  });

  test.each([
    ['IATA fuera de la tabla', { ...ok, origen: 'JFK' }, 'iata'],
    ['nombre de ciudad en vez de IATA', { ...ok, destino: 'Madrid' }, 'iata'],
    ['alias de ciudad de 3 letras', { ...ok, destino: 'RIO' }, 'iata'],
    ['ida en el pasado', { ...ok, fecha_ida: '2026-10-21', fecha_vuelta: null }, 'past'],
    ['vuelta antes de la ida', { ...ok, fecha_vuelta: '2026-12-01' }, 'returnDate'],
    ['fecha imposible', { ...ok, fecha_ida: '2026-02-30' }, 'departDate'],
    ['flex fuera de 0-7', { ...ok, flex_dias: 8 }, 'flex_dias'],
    ['flex no entero', { ...ok, flex_dias: 1.5 }, 'flex_dias'],
    ['clave extra (precio)', { ...ok, precio: 300 }, 'extra_key:precio'],
    ['mismo origen y destino', { ...ok, destino: 'COR' }, 'destination'],
    ['par que el bot no cubre', { ...ok, origen: 'MAD', destino: 'BCN' }, 'destination'],
  ])('fromLlm rechaza: %s', (_n, obj, error) => {
    expect(fromLlm(obj, { today })).toMatchObject({ ok: false, error });
  });

  test('fromLlm: todo null = no es búsqueda; faltan datos = incomplete; no objeto', () => {
    expect(fromLlm({ origen: null, destino: null, fecha_ida: null, fecha_vuelta: null, flex_dias: 0 }, { today }).error).toBe('not_search');
    expect(fromLlm({ ...ok, fecha_ida: null }, { today }).error).toBe('incomplete');
    expect(fromLlm({ ...ok, origen: null }, { today }).error).toBe('incomplete');
    expect(fromLlm([], { today }).ok).toBe(false);
    expect(fromLlm(null, { today }).ok).toBe(false);
  });

  test('fromLlm no reinterpreta fechas (nada de "próximo año" automático)', () => {
    expect(fromLlm({ ...ok, fecha_ida: '2026-03-10', fecha_vuelta: null }, { today }).error).toBe('past');
  });
});

test('rules parser', () => {
  expect(parseRules('eze mad 2026-12-10 2027-01-05 2 adultos')).toMatchObject({ origin: 'EZE', destination: 'MAD', returnDate: '2027-01-05', adults: 2 });
  expect(parseRules('quiero ir a madrid en diciembre')).toBeNull();
});

describe('parse (P1)', () => {
  test('las reglas resuelven sin llamar a la IA, sin gate ni cupo', async () => {
    const call = jest.fn();
    const out = await ai.parse(1, 'COR MAD 2026-12-10', { call, isPro: free });
    expect(out).toMatchObject({ ok: true, source: 'rules' });
    expect(call).not.toHaveBeenCalled();
  });

  test('apagada por defecto', async () => {
    delete process.env.AI_ENABLED;
    const call = jest.fn();
    expect((await ai.parse(1, 'córdoba a madrid el 10 de diciembre', { call, isPro: pro })).reason).toBe('disabled');
    expect(call).not.toHaveBeenCalled();
  });

  test.each([['GROQ_API_KEY'], ['MISTRAL_API_KEY']])('sin ninguna clave está apagada; con solo %s, prendida', async (only) => {
    delete process.env.GROQ_API_KEY; delete process.env.MISTRAL_API_KEY;
    expect(ai.enabled()).toBe(false);
    expect((await ai.parse(1, 'córdoba a madrid', { call: jest.fn(), isPro: pro })).reason).toBe('disabled');
    process.env[only] = 'test-key';
    expect(ai.enabled()).toBe(true);
  });

  test('gate Pro del servidor antes de cualquier llamada', async () => {
    const call = jest.fn(async () => ({ content: good, tokens: 10 }));
    expect((await ai.parse(1, 'córdoba a madrid', { call, isPro: free })).reason).toBe('not_pro');
    expect(call).not.toHaveBeenCalled();
    expect(await quota.used(1)).toBe(0);
    process.env.ADMIN_TELEGRAM_IDS = '777';
    expect((await ai.parse(777, 'córdoba a madrid', { call, isPro: free })).ok).toBe(true);
    delete process.env.ADMIN_TELEGRAM_IDS;
  });

  test('JSON válido: pide response_format json, max_tokens 120 y temperature 0 al proveedor', async () => {
    const call = jest.fn(async () => ({ content: good, tokens: 42 }));
    const out = await ai.parse(1, 'córdoba a madrid 10 dic', { call, isPro: pro });
    expect(out).toMatchObject({ ok: true, source: 'ai', value: { origin: 'COR', destination: 'MAD', departDate: '2026-12-10', flexDays: 0 } });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][2]).toMatchObject({ maxTokens: 120, json: true });
    expect(call.mock.calls[0][1][0].content).toContain('Hoy es 2026-10-22');
  });

  test('salida inválida: no se ejecuta nada y se le vuelve a preguntar al usuario', async () => {
    const bad = JSON.stringify({ origen: 'COR', destino: 'MAD', fecha_ida: '2026-10-01', fecha_vuelta: null, flex_dias: 0 });
    const call = jest.fn(async () => ({ content: bad, tokens: 5 }));
    expect(await ai.parse(1, 'cor a mad barato', { call, isPro: pro })).toEqual({ ok: false, reason: 'incomplete' });
    const prose = jest.fn(async () => ({ content: 'Claro! Te recomiendo Madrid', tokens: 5 }));
    // sin JSON: Groq y Mistral fallan → null → providers_down (cae al menú)
    expect((await ai.parse(2, 'cor a mad barato', { call: prose, isPro: pro })).reason).toBe('providers_down');
  });

  test('"no es una búsqueda" (todo null) devuelve not_search y no se cachea', async () => {
    const nulls = JSON.stringify({ origen: null, destino: null, fecha_ida: null, fecha_vuelta: null, flex_dias: 0 });
    const call = jest.fn(async () => ({ content: nulls, tokens: 5 }));
    expect((await ai.parse(1, 'hola qué tal', { call, isPro: pro })).reason).toBe('not_search');
    expect((await ai.parse(1, 'hola qué tal', { call, isPro: pro })).reason).toBe('not_search');
    expect(call).toHaveBeenCalledTimes(2);
  });

  test('la IA nunca aporta precios: respuesta con precio se rechaza', async () => {
    const call = jest.fn(async () => ({ content: JSON.stringify({ ...JSON.parse(good), precio: 300 }), tokens: 5 }));
    const out = await ai.parse(1, 'cor a mad barato', { call, isPro: pro });
    expect(out.ok).toBe(false);
  });

  test('caché por texto normalizado y por día ART; los aciertos no consumen cupo', async () => {
    const call = jest.fn(async () => ({ content: good, tokens: 5 }));
    await ai.parse(1, 'Córdoba a  Madrid', { call, isPro: pro });
    const again = await ai.parse(1, '  córdoba A madrid ', { call, isPro: pro });
    expect(again.source).toBe('cache');
    expect(call).toHaveBeenCalledTimes(1);
    expect(await quota.used(1)).toBe(1);
    expect(ai.health().cacheHits).toBe(1);
  });
});

describe('fallback Groq → Mistral → null', () => {
  const messages = [];
  const opts = (call) => ({ call, purpose: 'test' });
  const err = (status) => Object.assign(new Error('x'), { status });

  test('Groq falla (4xx, sin reintento) → Mistral responde', async () => {
    const call = jest.fn(async (p) => { if (p.name === 'groq') throw err(400); return { content: good, tokens: 7 }; });
    const out = await providers.complete('s', 'u', { name: 'x' }, 120, opts(call));
    expect(out).toMatchObject({ origen: 'COR' });
    expect(call.mock.calls.map((c) => c[0].name)).toEqual(['groq', 'mistral']);
    expect(ai.health()).toMatchObject({ fallbacks: 1, errors: 1 });
    expect(messages).toEqual([]);
  });

  test('error transitorio: 1 reintento en el mismo proveedor antes del fallback', async () => {
    const call = jest.fn(async (p) => { if (p.name === 'groq') throw err(503); return { content: good, tokens: 7 }; });
    await providers.complete('s', 'u', { name: 'x' }, 120, opts(call));
    expect(call.mock.calls.map((c) => c[0].name)).toEqual(['groq', 'groq', 'mistral']);
  });

  test('Groq responde sin JSON → pasa a Mistral sin reintentar', async () => {
    const call = jest.fn(async (p) => ({ content: p.name === 'groq' ? 'no sé' : good, tokens: 1 }));
    expect(await providers.complete('s', 'u', { name: 'x' }, 120, opts(call))).toMatchObject({ destino: 'MAD' });
    expect(call.mock.calls.map((c) => c[0].name)).toEqual(['groq', 'mistral']);
  });

  test('los dos fallan → null (el bot sigue con el menú) y el cupo se devuelve', async () => {
    const call = jest.fn(async () => { throw err(500); });
    expect(await providers.complete('s', 'u', { name: 'x' }, 120, opts(call))).toBeNull();
    expect(call).toHaveBeenCalledTimes(4);
    const out = await ai.parse(3, 'córdoba a madrid', { call, isPro: pro });
    expect(out).toEqual({ ok: false, reason: 'providers_down' });
    expect(await quota.used(3)).toBe(0);
  });

  test('sin clave de un proveedor se lo saltea; sin ninguna, null sin llamar', async () => {
    const call = jest.fn(async () => ({ content: good, tokens: 1 }));
    delete process.env.GROQ_API_KEY;
    await providers.complete('s', 'u', { name: 'x' }, 120, opts(call));
    expect(call.mock.calls.map((c) => c[0].name)).toEqual(['mistral']);
    delete process.env.MISTRAL_API_KEY;
    call.mockClear();
    expect(await providers.complete('s', 'u', { name: 'x' }, 120, opts(call))).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  test('sin schema devuelve {text}', async () => {
    const call = jest.fn(async () => ({ content: '  hola  ', tokens: 1 }));
    expect(await providers.complete('s', 'u', null, 60, opts(call))).toEqual({ text: 'hola' });
    expect(call.mock.calls[0][2].json).toBe(false);
  });
});

describe('tope diario (20 por usuario, día ART, contador atómico)', () => {
  test('20 pasan y la 21 cae al menú; otro usuario no se ve afectado', async () => {
    const call = jest.fn(async () => ({ content: good, tokens: 1 }));
    for (let i = 0; i < 20; i += 1) {
      expect((await ai.parse(5, `viaje ${i}`, { call, isPro: pro })).ok).toBe(true);
    }
    expect((await ai.parse(5, 'viaje 21', { call, isPro: pro })).reason).toBe('daily_cap');
    expect(call).toHaveBeenCalledTimes(20);
    expect(ai.health().capped).toBe(1);
    expect((await ai.parse(6, 'viaje 1', { call, isPro: pro })).ok).toBe(true);
  });

  test('concurrencia: 30 reservas en paralelo dejan pasar exactamente 20', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => quota.reserve(9)));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(await quota.used(9)).toBe(20);
  });

  test('se reinicia al día siguiente (ART) y no antes de la medianoche ART', async () => {
    for (let i = 0; i < 20; i += 1) await quota.reserve(7);
    expect(await quota.reserve(7)).toBe(false);
    clock.setNow(new Date('2026-10-23T02:59:00Z')); // 23:59 ART del 22
    expect(await quota.reserve(7)).toBe(false);
    clock.setNow(new Date('2026-10-23T03:01:00Z')); // 00:01 ART del 23
    expect(await quota.reserve(7)).toBe(true);
    expect(await quota.used(7)).toBe(1);
  });

  test('release nunca baja de 0', async () => {
    await quota.release(8);
    expect(await quota.used(8)).toBe(0);
    await quota.reserve(8);
    await quota.release(8);
    await quota.release(8);
    expect(await quota.used(8)).toBe(0);
  });
});

describe('providers (HTTP)', () => {
  const okFetch = (body) => jest.fn(async (_u, init) => {
    Object.assign(body, JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: good } }], usage: { total_tokens: 9 } }) };
  });

  test('modelos por defecto: Groq llama-3.1-8b-instant, Mistral mistral-small', () => {
    expect(providers.PROVIDERS.map((p) => [p.name, p.model])).toEqual([['groq', 'llama-3.1-8b-instant'], ['mistral', 'mistral-small']]);
    process.env.GROQ_MODEL = 'otro';
    expect(providers.PROVIDERS[0].model).toBe('otro');
  });

  test('temperature 0, response_format json, max_tokens topado en 150 y timeout de 5 s', async () => {
    const body = {};
    const fetchImpl = okFetch(body);
    const spy = jest.spyOn(AbortSignal, 'timeout');
    const out = await providers.callOne(providers.PROVIDERS[0], [], { maxTokens: 999, json: true, fetchImpl });
    expect(out).toMatchObject({ provider: 'groq', tokens: 9 });
    expect(body).toMatchObject({ temperature: 0, max_tokens: 150, response_format: { type: 'json_object' }, model: 'llama-3.1-8b-instant' });
    expect(spy).toHaveBeenCalledWith(5000);
    spy.mockRestore();
    const b2 = {};
    await providers.callOne(providers.PROVIDERS[1], [], { maxTokens: 60, fetchImpl: okFetch(b2) });
    expect(b2.response_format).toBeUndefined();
    expect(b2.max_tokens).toBe(60);
  });

  test('la clave sale del entorno y no aparece en logs ni en errores', async () => {
    process.env.GROQ_API_KEY = 'gsk_SECRET_VALUE_1234567890';
    const logs = [];
    const spies = ['log', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((l) => logs.push(String(l))));
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await providers.complete('s', 'u', { name: 'x' }, 120, { fetchImpl })).toBeNull();
    spies.forEach((s) => s.mockRestore());
    expect(logs.join('\n')).not.toMatch(/SECRET_VALUE/);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer gsk_SECRET_VALUE_1234567890');
  });
});

describe('logs: proveedor, latencia, tokens, cache_hit; nunca el texto del usuario', () => {
  test('una línea por llamada y por acierto de caché, sin el texto', async () => {
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation((l) => lines.push(String(l)));
    const call = jest.fn(async () => ({ content: good, tokens: 33 }));
    await ai.parse(1, 'quiero viajar a madrid con mi perro Firulais', { call, isPro: pro });
    await ai.parse(1, 'quiero viajar a madrid con mi perro Firulais', { call, isPro: pro });
    spy.mockRestore();
    const recs = lines.map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } }).filter((r) => r && r.msg === 'ai_call');
    expect(recs).toHaveLength(2);
    expect(recs[0]).toMatchObject({ purpose: 'nl_search', provider: 'groq', usage_total: 33, cache_hit: false });
    expect(typeof recs[0].latency_ms).toBe('number');
    expect(recs[1]).toMatchObject({ cache_hit: true });
    expect(lines.join('\n')).not.toMatch(/Firulais|madrid con mi perro/i);
  });
});
