'use strict';

const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const clock = require('../src/utils/clock');
const ai = require('../src/services/ai');
const advice = require('../src/services/ai/advice');
const quota = require('../src/services/ai/quota');
const aiHelp = require('../src/bot/handlers/aiHelp');
const naturalSearch = require('../src/bot/handlers/naturalSearch');
const priceHistory = require('../src/services/priceHistory');
const search = require('../src/services/search');
const tp = require('../src/providers/travelpayouts');

const pro = async () => true;
const free = async () => false;
const D = { routeKey: 'COR|MAD|2026-12-01||roundtrip||', origin: 'COR', destination: 'MAD', price: 890, min: 880, avg: 1100, lang: 'es' };
const LINE = 'Está cerca del mínimo de estos últimos días.';
const reply = (content) => jest.fn(async () => ({ content, tokens: 21 }));

beforeEach(() => {
  cleanEnv(); reset(); ai._reset();
  clock.setNow(new Date('2026-10-22T12:00:00Z'));
  process.env.AI_ENABLED = 'true';
  process.env.AI_ADVICE_ENABLED = 'true';
  process.env.AI_HELP_ENABLED = 'true';
  process.env.GROQ_API_KEY = 'test-groq';
});
afterAll(() => {
  clock.reset();
  for (const k of ['AI_ENABLED', 'AI_ADVICE_ENABLED', 'AI_HELP_ENABLED', 'GROQ_API_KEY']) delete process.env[k];
  jest.restoreAllMocks();
});

describe('P2 consejo de una línea', () => {
  test('devuelve la línea limpia, max_tokens 120, y al modelo solo le llegan datos calculados por código', async () => {
    const call = reply(`"${LINE}"`);
    expect(await advice.adviceFor(1, D, { call, isPro: pro })).toBe(LINE);
    const [, messages, o] = call.mock.calls[0];
    expect(o.maxTokens).toBe(120);
    const user = JSON.parse(messages.find((m) => m.role === 'user').content);
    expect(user).toEqual({ ruta: 'COR-MAD', senal: 'near_min' });
    expect(JSON.stringify(messages)).not.toMatch(/890|880|1100/); // ni precios ni historial
  });

  test.each([
    ['dígitos', 'Está en 900 hoy, aprovechá ya mismo.'],
    ['moneda', 'Está barato en euros, aprovechá ya mismo.'],
    ['enlace', 'Mirá en https://x.test que está barato.'],
    ['muy corto', 'Dale'],
  ])('rechaza la salida con %s', async (_n, text) => {
    expect(await advice.adviceFor(1, D, { call: reply(text), isPro: pro })).toBeNull();
  });

  test.each([
    ['punto más bajo + orden de compra (caso real de gpt-oss)', 'Compra ya, el precio está en su punto más bajo.'],
    ['mínimo histórico', 'Está en el mínimo histórico de la ruta, increíble.'],
    ['mejor precio', 'Es el mejor precio frente al promedio reciente.'],
    ['orden de compra', 'Comprá ya, está bajo el promedio reciente.'],
    ['urgencia', 'Aprovechá, está bajo el promedio reciente.'],
    ['no esperes', 'No esperes más, está bajo el promedio reciente.'],
    ['garantía', 'Precio garantizado frente al promedio reciente.'],
    ['predicción', 'Va a subir pronto según el historial reciente.'],
    ['buen momento', 'Buen momento: está cerca del mínimo reciente de la ruta.'],
    ['inglés', 'You should buy now, it is below the recent average.'],
    ['portugués', 'Melhor preço, abaixo da média recente.'],
    ['sin referencia a lo reciente (afirmación suelta)', 'Está muy barato para esta ruta.'],
  ])('rechaza afirmaciones absolutas u órdenes: %s', async (_n, text) => {
    expect(advice.clean(text)).toBeNull();
    expect(await advice.adviceFor(1, D, { call: reply(text), isPro: pro })).toBeNull();
  });

  test.each([
    'Está cerca del mínimo de estos últimos días.',
    'Se mantiene en el promedio reciente de la ruta.',
    'Hoy está algo más alto que el promedio reciente.',
    'Está por debajo del promedio de estos días, aunque puede cambiar.',
    'It is near the recent minimum.',
  ])('acepta descripciones relativas a lo reciente: %s', (text) => {
    expect(advice.clean(text)).toBe(text);
  });

  test('el prompt pide hablar en relativo y prohíbe absolutos, órdenes y garantías', async () => {
    const call = reply(LINE);
    await advice.adviceFor(1, D, { call, isPro: pro });
    const sys = call.mock.calls[0][1].find((m) => m.role === 'system').content;
    expect(sys).toMatch(/relativo a lo reciente/);
    expect(sys).toMatch(/PROHIBIDO/);
    expect(sys).toMatch(/punto más bajo/);
    expect(sys).toMatch(/No recomiendes comprar/);
  });

  test('caché por (ruta, día ART) 24 h: la segunda vez no llama ni cuenta cupo', async () => {
    const call = reply(LINE);
    await advice.adviceFor(1, D, { call, isPro: pro });
    expect(await quota.used(1)).toBe(1);
    expect(await advice.adviceFor(2, D, { call, isPro: pro })).toBe(LINE); // otro usuario Pro, misma ruta
    expect(call).toHaveBeenCalledTimes(1);
    expect(await quota.used(2)).toBe(0);
    // otra ruta = otra clave
    await advice.adviceFor(1, { ...D, routeKey: 'COR|BCN|2026-12-05||oneway||', destination: 'BCN' }, { call, isPro: pro });
    expect(call).toHaveBeenCalledTimes(2);
    // día ART siguiente = otra clave
    clock.setNow(new Date('2026-10-23T12:00:00Z'));
    await advice.adviceFor(1, D, { call, isPro: pro });
    expect(call).toHaveBeenCalledTimes(3);
  });

  test('solo una llamada para pedidos simultáneos de la misma ruta', async () => {
    const call = reply(LINE);
    await Promise.all([1, 2, 3].map((u) => advice.adviceFor(u, D, { call, isPro: pro })));
    expect(call).toHaveBeenCalledTimes(1);
  });

  test('gate Pro en el servidor, antes de cualquier llamada; apagado por defecto; sin datos', async () => {
    const call = reply(LINE);
    expect(await advice.adviceFor(1, D, { call, isPro: free })).toBeNull();
    delete process.env.AI_ADVICE_ENABLED;
    expect(await advice.adviceFor(1, D, { call, isPro: pro })).toBeNull();
    process.env.AI_ADVICE_ENABLED = 'true';
    expect(await advice.adviceFor(1, { ...D, min: 0 }, { call, isPro: pro })).toBeNull();
    delete process.env.GROQ_API_KEY;
    expect(await advice.adviceFor(1, D, { call, isPro: pro })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  test('proveedores caídos o tope diario: null y no rompe', async () => {
    const down = jest.fn(async () => { throw Object.assign(new Error('x'), { status: 400 }); });
    expect(await advice.adviceFor(1, D, { call: down, isPro: pro })).toBeNull();
    expect(await quota.used(1)).toBe(0); // se devuelve el cupo si no hubo respuesta
    for (let i = 0; i < 20; i++) await quota.reserve(7);
    const call = reply(LINE);
    expect(await advice.adviceFor(7, D, { call, isPro: pro })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  test('signalOf / statsOf', () => {
    expect(advice.signalOf(100, 100, 150)).toBe('near_min');
    expect(advice.signalOf(130, 100, 150)).toBe('below_avg');
    expect(advice.signalOf(150, 100, 150)).toBe('near_avg');
    expect(advice.signalOf(200, 100, 150)).toBe('above_avg');
    expect(advice.statsOf(900, [{ price: 1000 }])).toBeNull(); // poco historial
    expect(advice.statsOf(900, [{ price: 1000 }, { price: 1200 }])).toEqual({ min: 900, avg: 1100 });
  });

  test('forAlert: usa el historial de la ruta y nunca lanza', async () => {
    const route = { telegramUserId: 1, origin: 'COR', destination: 'MAD', departureDate: '2026-12-01', tripType: 'roundtrip' };
    jest.spyOn(priceHistory, 'history').mockResolvedValue([{ price: 1000 }, { price: 1200 }]);
    expect(await advice.forAlert(route, { price: 900 }, clock.now(), { call: reply(LINE), isPro: pro })).toBe(LINE);
    priceHistory.history.mockRejectedValue(new Error('db'));
    expect(await advice.forAlert(route, { price: 900 }, clock.now(), { call: reply(LINE), isPro: pro })).toBeNull();
  });

  test('attachToReport: agrega advice a las tarjetas con historial; reutiliza la caché de la alerta', async () => {
    const call = reply(LINE);
    await advice.adviceFor(1, D, { call, isPro: pro }); // la alerta la dejó en caché
    const report = { full: [
      { state: 'priced', title: 'COR \u2192 MAD', price: 900, routeKey: D.routeKey },
      { state: 'empty', title: 'X \u2192 Y', routeKey: 'k' },
    ] };
    const hist = new Map([[D.routeKey, [{ price: 880 }, { price: 1300 }]]]);
    await advice.attachToReport(1, report, hist, 'es', { call, isPro: pro });
    expect(report.full[0].advice).toBe(LINE);
    expect(report.full[1].advice).toBeUndefined();
    expect(call).toHaveBeenCalledTimes(1);
    // apagado: el informe queda igual
    delete process.env.AI_ADVICE_ENABLED;
    const r2 = { full: [{ state: 'priced', title: 'COR \u2192 MAD', price: 900, routeKey: D.routeKey }] };
    await advice.attachToReport(1, r2, hist, 'es', { call, isPro: pro });
    expect(r2.full[0].advice).toBeUndefined();
  });
});

describe('P3 ayuda libre', () => {
  test('responde sin precios, max_tokens 150, y apaga por defecto', async () => {
    const call = reply('Podés escribirme una ruta y una fecha, o usar el menú para tus alertas.');
    const out = await ai.help(1, 'cómo funciona esto?', { call, isPro: pro });
    expect(out).toEqual({ ok: true, text: expect.stringMatching(/menú/) });
    expect(call.mock.calls[0][2].maxTokens).toBe(150);
    expect(call.mock.calls[0][1][0].content).toMatch(/precio/i); // el prompt prohíbe precios
    delete process.env.AI_HELP_ENABLED;
    expect((await ai.help(1, 'hola', { call, isPro: pro })).ok).toBe(false);
  });

  test.each([
    ['precio', 'Los vuelos salen 900 euros hoy.'],
    ['moneda', 'Salen unos pocos dólares menos.'],
    ['enlace', 'Entrá a https://x.test para ver.'],
    ['mención', 'Escribile a @soporte para ayuda.'],
    ['comando inventado', 'Probá con /comprarvuelo para seguir.'],
  ])('descarta la salida con %s', async (_n, text) => {
    const out = await ai.help(1, 'ayuda', { call: reply(text), isPro: pro });
    expect(out.ok).toBe(false);
  });

  test('un comando real se acepta', () => {
    expect(ai.cleanHelp('Usá /start para volver al menú principal.')).toMatch(/\/start/);
  });

  test('gate Pro antes de llamar; free no consume ni llama', async () => {
    const call = reply('Probá el menú para ver tus alertas y búsquedas.');
    expect((await ai.help(1, 'ayuda', { call, isPro: free })).ok).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  test('handler: responde con el menú; msg.aiCapped o apagado = false (cae al menú de siempre)', async () => {
    const providers = require('../src/services/ai/providers');
    jest.spyOn(providers, 'callOne').mockResolvedValue({ content: 'Escribime una ruta y una fecha, o tocá el menú.', tokens: 12 });
    const sent = [];
    const bot = { sendMessage: jest.fn(async (...a) => { sent.push(a); }) };
    process.env.ADMIN_TELEGRAM_IDS = '55';
    const msg = { chat: { id: 55 }, from: { id: 55, language_code: 'es' }, text: 'qué podés hacer?' };
    expect(await aiHelp.handleText(bot, { ...msg, aiCapped: true })).toBe(false);
    expect(await aiHelp.handleText(bot, msg)).toBe(true);
    expect(sent[0][1]).toMatch(/menú/);
    expect(sent[0][2].reply_markup).toBeDefined();
    delete process.env.AI_HELP_ENABLED;
    expect(await aiHelp.handleText(bot, msg)).toBe(false);
    delete process.env.ADMIN_TELEGRAM_IDS;
  });
});

describe('P1 ventana flexible', () => {
  const v = { origin: 'COR', destination: 'MAD', departDate: '2026-12-01', returnDate: null, adults: 1, flexDays: 0 };

  test('sin flex: consulta exacta, igual que siempre', () => {
    expect(naturalSearch.queryFrom(v, '2026-10-22')).toEqual({ origin: 'COR', destination: 'MAD', departureDate: '2026-12-01', returnDate: null, adults: 1 });
  });

  test('con flex: meses, from/to acotados a hoy, y estadía si hay vuelta', () => {
    const q = naturalSearch.queryFrom({ ...v, flexDays: 3 }, '2026-10-22');
    expect(q).toMatchObject({ months: ['2026-11', '2026-12'], from: '2026-11-28', to: '2026-12-04', oneway: true });
    const r = naturalSearch.queryFrom({ ...v, returnDate: '2026-12-15', flexDays: 2 }, '2026-10-22');
    expect(r).toMatchObject({ oneway: false, stay: 14, from: '2026-11-29', to: '2026-12-03' });
    const near = naturalSearch.queryFrom({ ...v, departDate: '2026-10-23', flexDays: 7 }, '2026-10-22');
    expect(near.from).toBe('2026-10-22'); // nunca antes de hoy
  });

  test('travelpayouts respeta el tope "to" y queryHash solo cambia cuando hay ventana', () => {
    const dates = tp.sampleDates({ months: ['2026-12'], from: '2026-12-10', to: '2026-12-12' }, new Date('2026-10-22T12:00:00Z'));
    expect(dates.every((d) => d >= '2026-12-10' && d <= '2026-12-12')).toBe(true);
    const base = { origin: 'COR', destination: 'MAD', months: ['2026-12'], from: '2026-12-01' };
    expect(search.queryHash(base)).toBe(search.queryHash({ ...base }));
    expect(search.queryHash({ ...base, to: '2026-12-05' })).not.toBe(search.queryHash(base));
    expect(search.queryHash({ ...base, to: '2026-12-05' })).not.toBe(search.queryHash({ ...base, to: '2026-12-06' }));
  });
});
