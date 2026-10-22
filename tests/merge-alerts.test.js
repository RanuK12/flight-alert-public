'use strict';

// #13 sobre #10: consultas flexibles (queryFor/matchesRoute) + dedup por banda y outbox.
jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn(), searchRange: jest.fn() }));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true) }));

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const travelpayouts = require('../src/providers/travelpayouts');
const notifier = require('../src/bot/notifier');
const instant = require('../src/services/instantAlerts');
const { runSearch } = require('../src/services/search');

const HOUR = 3600 * 1000;
const at = (iso) => clock.setNow(new Date(iso));
const fl = (dep, ret, price = 480) => ({
  origin: 'EZE', destination: 'MAD', departureDate: dep, returnDate: ret, price, currency: 'EUR',
  stops: 1, durationMin: 800, foundAt: new Date(clock.now().getTime() - 2 * HOUR).toISOString(),
});
const pro = (id) => col('Entitlement').create({ telegramUserId: String(id), plan: 'pro', searchesUsed: 0,
  proUntil: new Date(clock.now().getTime() + 20 * 24 * HOUR).toISOString() });
const route = (id, extra) => col('Route').create({ telegramUserId: String(id), telegramChatId: String(id),
  origin: 'EZE', destination: 'MAD', outboundDate: '2026-12-10', returnDate: null, priceThreshold: 500, paused: false, ...extra });

beforeEach(() => {
  cleanEnv(); reset(); rateLimit.reset(); clock.reset();
  process.env.FEATURE_SEARCH = 'on';
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  travelpayouts.search.mockReset(); travelpayouts.searchRange.mockReset(); notifier.send.mockClear();
});
afterEach(() => { cleanEnv(); clock.reset(); });

test('exporta lo de ambos lados', () => {
  expect(typeof instant.queryFor).toBe('function');
  expect(typeof instant.matchesRoute).toBe('function');
  expect(typeof instant.priceBand).toBe('function');
});

test('solo ida vs ida y vuelta: grupos y consultas distintos, cada uno recibe su vuelo', async () => {
  at('2026-10-21T15:00:00.000Z');
  await pro('1'); await pro('2');
  await route('1', { tripType: 'oneway' });
  await route('2', { tripType: 'roundtrip', returnDate: '2026-12-24' });
  travelpayouts.search.mockImplementation(async (q) => (q.returnDate ? [fl('2026-12-10', '2026-12-24', 620), fl('2026-12-10', null, 300)] : [fl('2026-12-10', null, 410), fl('2026-12-10', '2026-12-24', 200)]));
  const ow = { tripType: 'oneway', outboundDate: '2026-12-10', returnDate: null };
  const rt = { tripType: 'roundtrip', outboundDate: '2026-12-10', returnDate: '2026-12-24' };
  expect(instant.groupKey({ origin: 'EZE', destination: 'MAD', ...ow })).not.toBe(instant.groupKey({ origin: 'EZE', destination: 'MAD', ...rt }));
  await col('Route').updateOne({ telegramUserId: '2' }, { $set: { priceThreshold: 700 } });
  const out = await instant.run({});
  expect(out.calls).toBe(2);
  const byChat = Object.fromEntries(notifier.send.mock.calls.map(([, chat, text]) => [chat, text]));
  expect(byChat['1']).toMatch(/€410 · 2026-12-10\n/);
  expect(byChat['2']).toMatch(/€620 · 2026-12-10 → 2026-12-24/);
});

test('flexible por rango + dedup por banda: no repite un precio casi igual, y el outbox queda en sent', async () => {
  at('2026-10-21T15:00:00.000Z');
  await pro('1');
  await route('1', { tripType: 'roundtrip', flexMonth: '2026-12', returnDate: '2027-01-05' });
  travelpayouts.searchRange.mockResolvedValue([fl('2026-12-12', '2027-01-05', 480), fl('2026-12-12', '2027-01-09', 300)]);
  expect((await instant.run({})).sent).toBe(1);
  expect(travelpayouts.searchRange).toHaveBeenCalledWith(expect.objectContaining({ months: ['2026-12'], oneway: false, returnDate: '2027-01-05' }));
  expect(travelpayouts.search).not.toHaveBeenCalled();
  expect((await col('Notification').find({ kind: 'instant' }).lean()).map((r) => r.status)).toEqual(['sent']);
  // pasado el cooldown, 482 cae en la banda de 480 → no se manda de nuevo
  at('2026-10-22T04:00:00.000Z'); // 01:00 ART es silencio; probamos a las 10 ART
  at('2026-10-22T13:00:00.000Z');
  travelpayouts.searchRange.mockResolvedValue([fl('2026-12-12', '2027-01-05', 482)]);
  expect((await instant.run({})).sent).toBe(0);
  // 440 queda fuera de la banda → sí avisa
  travelpayouts.searchRange.mockResolvedValue([fl('2026-12-12', '2027-01-05', 440)]);
  expect((await instant.run({})).sent).toBe(1);
});

test('el deep link lleva las mismas fechas y moneda que el precio mostrado', async () => {
  at('2026-10-21T15:00:00.000Z');
  await pro('1');
  await route('1', { tripType: 'roundtrip', returnDate: '2026-12-24' });
  travelpayouts.search.mockResolvedValue([fl('2026-12-10', '2026-12-24', 455)]);
  await instant.run({});
  const [, , text, extra] = notifier.send.mock.calls[0];
  const url = extra.reply_markup.inline_keyboard[0][0].url;
  expect(text).toMatch(/€455 · 2026-12-10 → 2026-12-24/);
  expect(url).toMatch(/\/EZE1012MAD24121\?/);
  expect(url).toMatch(/currency=eur/);
  expect(url).toMatch(/marker=793462/);
});

test('paywall Free: 10 búsquedas por mes; la siguiente devuelve 402 y no consulta al proveedor', async () => {
  travelpayouts.search.mockImplementation(async (q) => [fl(q.departureDate, null)]);
  let t = new Date('2026-10-21T15:00:00.000Z').getTime();
  for (let i = 0; i < 10; i += 1) {
    t += 11 * 1000; clock.setNow(new Date(t));
    expect((await runSearch('9', { origin: 'EZE', destination: 'MAD', departureDate: `2026-12-${String(i + 1).padStart(2, '0')}` })).status).toBe(200);
  }
  const calls = travelpayouts.search.mock.calls.length;
  t += 11 * 1000; clock.setNow(new Date(t));
  const r = await runSearch('9', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-25' });
  expect(r.status).toBe(402);
  expect(r.paywall).toBe(true);
  expect(travelpayouts.search.mock.calls.length).toBe(calls);
});

test('Pro: si el proveedor falla se devuelve el cupo diario reservado', async () => {
  at('2026-10-21T15:00:00.000Z');
  await pro('5');
  travelpayouts.search.mockRejectedValueOnce(new Error('down'));
  await expect(runSearch('5', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-01' })).rejects.toThrow('down');
  const e = await col('Entitlement').findOne({ telegramUserId: '5' });
  expect(Number(e.proSearchesToday || 0)).toBe(0);
});
