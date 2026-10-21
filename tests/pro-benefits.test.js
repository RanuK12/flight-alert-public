'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn() }));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true) }));

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const travelpayouts = require('../src/providers/travelpayouts');
const notifier = require('../src/bot/notifier');
const { runSearch } = require('../src/services/search');
const jobLock = require('../src/services/jobLock');
const scheduler = require('../src/services/scheduler');
const instant = require('../src/services/instantAlerts');
const samplePrice = require('../src/services/samplePrice');

const HOUR = 60 * 60 * 1000;
const at = (iso) => clock.setNow(new Date(iso));

function row(q, price = 480) {
  return {
    origin: q.origin, destination: q.destination, departureDate: q.departureDate,
    returnDate: q.returnDate || null, price, stops: 1, durationMin: 800,
    foundAt: new Date(clock.now().getTime() - 2 * HOUR).toISOString(), currency: 'EUR', actual: true,
  };
}

async function makePro(id) {
  await col('Entitlement').create({
    telegramUserId: String(id), plan: 'pro', searchesUsed: 0,
    proUntil: new Date(clock.now().getTime() + 20 * 24 * HOUR).toISOString(),
  });
}

beforeEach(() => {
  cleanEnv();
  reset();
  rateLimit.reset();
  clock.reset();
  samplePrice.reset();
  process.env.FEATURE_SEARCH = 'on';
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  travelpayouts.search.mockReset();
  travelpayouts.search.mockImplementation(async (q) => [row(q)]);
  notifier.send.mockClear();
});
afterEach(() => { cleanEnv(); clock.reset(); });

describe('límites de búsqueda', () => {
  test('Pro: sin cupo mensual, tope 10 por minuto con mensaje amable', async () => {
    at('2026-10-21T15:00:00.000Z');
    await makePro('7');
    for (let i = 0; i < 10; i += 1) {
      const r = await runSearch('7', { origin: 'EZE', destination: 'MAD', departureDate: `2026-12-${String(i + 1).padStart(2, '0')}` });
      expect(r.status).toBe(200);
    }
    const capped = await runSearch('7', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-20' });
    expect(capped.status).toBe(429);
    expect(capped.proCap).toBe('minute');
    expect(capped.text).toMatch(/minuto/);
    const doc = await col('Entitlement').findOne({ telegramUserId: '7' });
    expect(doc.searchesUsed).toBe(0);
  });

  test('Pro: tope diario configurable, se renueva al día siguiente (hora ART)', async () => {
    process.env.PRO_SEARCH_PER_DAY = '3';
    let t = new Date('2026-10-21T15:00:00.000Z').getTime();
    clock.setNow(new Date(t));
    await makePro('8');
    for (let i = 0; i < 3; i += 1) {
      t += 61 * 1000; clock.setNow(new Date(t));
      expect((await runSearch('8', { origin: 'EZE', destination: 'MAD', departureDate: `2026-12-0${i + 1}` })).status).toBe(200);
    }
    const capped = await runSearch('8', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-09' });
    expect(capped.status).toBe(429);
    expect(capped.proCap).toBe('day');
    expect(capped.text).toMatch(/3 búsquedas/);
    at('2026-10-22T04:00:00.000Z'); // 01:00 ART del 22
    expect((await runSearch('8', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-09' })).status).toBe(200);
  });

  test('Free sigue con 10 por mes', async () => {
    let t = new Date('2026-10-21T15:00:00.000Z').getTime();
    for (let i = 0; i < 10; i += 1) {
      t += 11 * 1000; clock.setNow(new Date(t));
      expect((await runSearch('9', { origin: 'EZE', destination: 'MAD', departureDate: `2026-12-${String(i + 1).padStart(2, '0')}` })).status).toBe(200);
    }
    t += 11 * 1000; clock.setNow(new Date(t));
    expect((await runSearch('9', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-25' })).status).toBe(402);
  });
});

describe('lock en Mongo', () => {
  test('dos dueños: solo uno toma el lease; vencido, lo toma el otro', async () => {
    at('2026-10-21T15:00:00.000Z');
    expect(await jobLock.acquire('x', 60000, 'A')).toBe(true);
    expect(await jobLock.acquire('x', 60000, 'B')).toBe(false);
    at('2026-10-21T15:01:01.000Z');
    expect(await jobLock.acquire('x', 60000, 'B')).toBe(true);
    await jobLock.release('x', 'A'); // A ya no es dueño: no libera
    expect(await jobLock.acquire('x', 60000, 'A')).toBe(false);
    await jobLock.release('x', 'B');
    expect(await jobLock.acquire('x', 60000, 'A')).toBe(true);
  });

  test('si otra instancia tiene el lock, el job no corre', async () => {
    at('2026-10-21T21:05:00.000Z'); // 18:05 ART, fuera de ventana; usamos un job a medida
    const run = jest.fn();
    const job = { name: 'j', window: () => ({ key: 'k1', at: clock.now() }), graceMs: HOUR, leaseMs: 60000, run };
    await jobLock.acquire('j', 60000, 'otra-instancia');
    expect(await scheduler.runDue(job)).toBe('locked');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('scheduler: idempotencia y recuperación', () => {
  const digestJob = (run) => scheduler.buildJobs({ digest: run }).find((j) => j.name === 'digest');

  test('el informe de las 21:00 corre una sola vez por día aunque haya muchos ticks', async () => {
    const run = jest.fn().mockResolvedValue({});
    const job = digestJob(run);
    at('2026-10-22T00:00:30.000Z'); // 21:00:30 ART
    expect(await scheduler.runDue(job)).toBe('ran');
    at('2026-10-22T00:01:30.000Z');
    expect(await scheduler.runDue(job)).toBe('done');
    at('2026-10-22T01:30:00.000Z');
    expect(await scheduler.runDue(job)).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
    const st = await jobLock.state('digest');
    expect(st.lastWindow).toBe('2026-10-21T21');
    expect(st.lastRunAt).toBe('2026-10-22T01:30:00.000Z'.replace('01:30:00', '00:00:30'));
  });

  test('recuperación: el servicio dormía a las 21, despierta 22:40 y corre una vez', async () => {
    const run = jest.fn().mockResolvedValue({});
    const job = digestJob(run);
    at('2026-10-22T01:40:00.000Z'); // 22:40 ART
    expect(await scheduler.runDue(job)).toBe('ran');
    expect(await scheduler.runDue(job)).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('fuera del margen no se recupera (despierta 02:00 ART)', async () => {
    const run = jest.fn();
    const job = digestJob(run);
    at('2026-10-22T05:00:00.000Z'); // 02:00 ART, margen 3 h
    expect(await scheduler.runDue(job)).toBe('late');
    expect(run).not.toHaveBeenCalled();
  });

  test('si el job falla no se marca hecho y se reintenta en el próximo tick', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue({});
    const job = digestJob(run);
    at('2026-10-22T00:00:30.000Z');
    expect(await scheduler.runDue(job)).toBe('error');
    at('2026-10-22T00:01:30.000Z');
    expect(await scheduler.runDue(job)).toBe('ran');
  });

  test('ventanas: cada 3 h desde 00:00 ART y diaria a las 10', () => {
    const w3 = scheduler.everyHours(3)(new Date('2026-10-21T19:10:00.000Z')); // 16:10 ART
    expect(w3.key).toBe('2026-10-21T15');
    const w10 = scheduler.dailyAt(10)(new Date('2026-10-21T12:00:00.000Z')); // 09:00 ART → la de ayer
    expect(w10.key).toBe('2026-10-20T10');
  });
});

describe('alerta instantánea', () => {
  async function route(id, extra = {}) {
    return col('Route').create({
      telegramUserId: String(id), telegramChatId: String(id), origin: 'EZE', destination: 'MAD',
      tripType: 'oneway', outboundDate: '2026-12-10', returnDate: null, priceThreshold: 500, paused: false, ...extra,
    });
  }

  test('avisa en o debajo del techo, con deep link y "visto hace"; agrupa rutas iguales', async () => {
    at('2026-10-21T15:00:00.000Z'); // 12:00 ART
    await makePro('1'); await makePro('2');
    await route('1'); await route('2'); await route('3'); // 3 no es Pro
    const out = await instant.run({});
    expect(out.calls).toBe(1);
    expect(out.sent).toBe(2);
    const [, chat, text, extra] = notifier.send.mock.calls[0];
    expect(chat).toBe('1');
    expect(text).toMatch(/visto hace 2 h/);
    expect(extra.reply_markup.inline_keyboard[0][0].url).toMatch(/EZE1012MAD1\?marker=793462&currency=eur/);
  });

  test('arriba del techo no avisa', async () => {
    at('2026-10-21T15:00:00.000Z');
    await makePro('1'); await route('1', { priceThreshold: 400 });
    expect((await instant.run({})).sent).toBe(0);
  });

  test('cooldown de 12 h por alerta y dedupe por ruta+precio+fecha', async () => {
    at('2026-10-21T15:00:00.000Z');
    await makePro('1'); await route('1');
    expect((await instant.run({})).sent).toBe(1);
    travelpayouts.search.mockImplementation(async (q) => [row(q, 470)]);
    at('2026-10-21T21:00:00.000Z'); // +6 h: cooldown
    expect((await instant.run({})).sent).toBe(0);
    at('2026-10-22T13:00:00.000Z'); // +22 h, precio nuevo 470
    expect((await instant.run({})).sent).toBe(1);
    await col('Route').updateMany({}, { $set: { instantLastAt: null } });
    at('2026-10-22T14:00:00.000Z'); // sin cooldown pero mismo precio y fecha → dedupe
    expect((await instant.run({})).sent).toBe(0);
  });

  test('silencio 00–08 ART y kill switch', async () => {
    await makePro('1'); await route('1');
    at('2026-10-21T06:00:00.000Z'); // 03:00 ART
    expect(await instant.run({})).toMatchObject({ quiet: true });
    process.env.FEATURE_INSTANT_ALERTS = 'off';
    at('2026-10-21T15:00:00.000Z');
    expect(await instant.run({})).toEqual({ skipped: true });
    expect(notifier.send).not.toHaveBeenCalled();
  });

  test('tope de avisos por día por usuario', async () => {
    process.env.INSTANT_ALERTS_MAX_PER_DAY = '1';
    at('2026-10-21T15:00:00.000Z');
    await makePro('1');
    await route('1');
    await route('1', { destination: 'BCN' });
    expect((await instant.run({})).sent).toBe(1);
  });
});

test('el precio de muestra sobrevive un reinicio (Mongo)', async () => {
  at('2026-10-21T15:00:00.000Z');
  samplePrice.remember(row({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10' }, 455));
  await new Promise((r) => setImmediate(r));
  samplePrice.reset();
  expect(samplePrice.current()).toBeNull();
  await samplePrice.load();
  expect(samplePrice.current()).toMatchObject({ origin: 'EZE', destination: 'MAD', price: 455 });
});
