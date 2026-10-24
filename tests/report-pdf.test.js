'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true) }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const duffel = require('../src/providers/duffel');
const notifier = require('../src/bot/notifier');
const cov = require('../src/config/coverage');
const instant = require('../src/services/instantAlerts');
const daily = require('../src/services/dailyReport');
const rd = require('../src/services/reportData');
const ph = require('../src/services/priceHistory');
const { renderReport } = require('../src/services/reportPdf');
const I18N = require('../src/services/report.i18n.json');

const HOUR = 3600000;
const NOW = '2026-10-24T15:00:00.000Z'; // 12:00 ART
const now = () => new Date(NOW);
const ago = (h) => new Date(Date.parse(NOW) - h * HOUR).toISOString();
const EXTRA = ['FEATURE_INSTANT_ALERTS', 'FEATURE_REPORT_PDF', 'DUFFEL_RANGE_MAX', 'DUFFEL_RANGE_BUDGET_MS', 'DUFFEL_TICK_RANGE_MAX',
  'DIGEST_DUFFEL_MAX', 'DIGEST_LIVE_MAX', 'DIGEST_CONCURRENCY', 'DIGEST_ROUTE_TIMEOUT_MS', 'DIGEST_DEADLINE_MS', 'DIGEST_DUFFEL_PER_ROUTE'];

function offer(amount) {
  return { data: { data: { live_mode: false, offers: [
    { total_amount: String(amount), total_currency: 'EUR', owner: { iata_code: 'IB' }, slices: [{ duration: 'PT14H5M', segments: [{}, {}] }] },
  ] } }, headers: {} };
}
function routeAxios(amount = 450) {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('frankfurter')) return { data: { rates: { EUR: 0.9 } } };
    return { data: { data: [] }, headers: {} };
  });
  axios.post.mockImplementation(async () => offer(amount));
}

const DEAL = { _id: 'r1', origin: 'COR', destination: 'MAD', tripType: 'roundtrip', outboundDate: '2026-11-10', returnDate: '2026-11-24', priceThreshold: 1200,
  lastPriceEur: 1069, foundAt: ago(5), stops: 1, source: 'duffel', confirmedAt: ago(1), gate: 'IB', bestDepartureDate: '2026-11-10', bestReturnDate: '2026-11-24' };
const ABOVE = { _id: 'r2', origin: 'ROS', destination: 'MAD', tripType: 'roundtrip', flexMonth: '2026-12', stayDays: 14, outboundDate: '2026-12-01', priceThreshold: 900,
  lastPriceEur: 1127, foundAt: ago(3), stops: 2, source: 'travelpayouts', gate: 'AR' };
const STALE = { _id: 'r3', origin: 'COR', destination: 'BCN', tripType: 'oneway', outboundDate: '2026-12-05', priceThreshold: 600, lastPriceEur: 700, foundAt: ago(49) };
const NEVER = { _id: 'r4', origin: 'EZE', destination: 'FCO', tripType: 'oneway', outboundDate: '2026-12-05', priceThreshold: 600 };

function hist(route, prices) {
  const m = new Map();
  m.set(ph.routeKey(route), prices.map((p, i) => ({ date: ph.dayOf(new Date(Date.parse(NOW) - (prices.length - 1 - i) * 864e5)), price: p })));
  return m;
}
function strip(r) {
  const { pageLabel, ...rest } = r;
  return rest;
}

let covFile;
beforeEach(() => {
  cleanEnv(); reset(); duffel.reset(); clock.reset();
  for (const k of EXTRA) delete process.env[k];
  clock.setNow(now());
  axios.get.mockReset(); axios.post.mockReset(); notifier.send.mockClear(); notifier.sendDocument.mockClear();
  daily.setRenderer(null);
  covFile = path.join(os.tmpdir(), `cov-report-${process.pid}.json`);
  fs.writeFileSync(covFile, JSON.stringify({ withData: [], withDuffel: [{ origin: 'ROS', destination: 'MAD' }, { origin: 'COR', destination: 'MAD' }], byOrigin: {}, duffelMethod: cov.DUFFEL_METHOD }));
  process.env.COVERAGE_FILE = covFile;
  process.env.TRAVELPAYOUTS_TOKEN = 'tp-test';
});
afterEach(() => { cleanEnv(); for (const k of EXTRA) delete process.env[k]; clock.reset(); daily.setRenderer(null); try { fs.unlinkSync(covFile); } catch (_) { /* */ } });

describe('schema Route', () => {
  test('flexMonth/stayDays/notify/lang sobreviven al modelo (strict) y al guardar/recargar', async () => {
    const Route = require('../src/database/models/Route');
    const doc = new Route({ telegramUserId: '1', origin: 'ROS', destination: 'MAD', outboundDate: '2026-12-01', flexMonth: '2026-12', stayDays: 14, notify: 'instant', lang: 'pt' }).toObject();
    expect(doc).toMatchObject({ flexMonth: '2026-12', stayDays: 14, notify: 'instant', lang: 'pt' });
    // Guardado y recarga (store en memoria con el objeto ya pasado por el schema).
    await col('Route').create(doc);
    const back = await col('Route').findOne({ telegramUserId: '1' });
    expect(back).toMatchObject({ flexMonth: '2026-12', stayDays: 14 });
    expect(instant.queryFor(back, now()).kind).toBe('range');
  });
  test('User guarda lang y firstName', () => {
    const User = require('../src/database/models/User');
    expect(new User({ telegramUserId: '1', lang: 'en', firstName: 'Ana' }).toObject()).toMatchObject({ lang: 'en', firstName: 'Ana' });
  });
});

describe('DTO y estados', () => {
  test('snapshot del informe mixto (deal, arriba, vencido, nunca visto)', () => {
    const r = rd.buildReport({ routes: [NEVER, STALE, ABOVE, DEAL], user: { firstName: 'Emilio' }, now: now(), lang: 'es', histByKey: hist(DEAL, [1100, 1090, 1080, 1075, 1072, 1070, 1080, 1069]), links: { edit: 'https://t.me/b/app?startapp=alerts', manage: 'https://t.me/b/app' } });
    expect(r.cards.map((c) => c.state)).toEqual(['deal', 'above', 'empty', 'empty']);
    expect(strip(r)).toMatchSnapshot();
  });
  test('fresco ≤48 h; a las 49 h pasa a vacío con último precio, tip y CTA', () => {
    const r = rd.buildReport({ routes: [STALE], now: now(), lang: 'es', links: { edit: 'https://x/e' } });
    const c = r.cards[0];
    expect(c.state).toBe('empty');
    expect(c.lastSeen).toMatch(/Último visto: .*700, hace 2 días/);
    expect(c.tip).toBeTruthy();
    expect(c.ctaUrl).toBe('https://x/e');
    expect(r.allEmpty).toBe(true);
    expect(rd.captionFor(r)).toContain('Hoy no hubo precios nuevos para tus 1 rutas');
  });
  test('arriba del tope ≠ sin precio (texto y caption)', () => {
    const r = rd.buildReport({ routes: [ABOVE], now: now(), lang: 'es' });
    expect(r.cards[0].state).toBe('above');
    expect(r.cards[0].vsCeiling).toBe('+25\u00A0% arriba');
    expect(rd.textFor(r).header).toContain('ninguna está bajo tu tope');
    const e = rd.buildReport({ routes: [NEVER], now: now(), lang: 'es' });
    expect(rd.textFor(e).header).toContain('Todavía no hay un precio fresco');
  });
  test('sin historial no hay delta ni sparkline (nunca "0 %")', () => {
    const r = rd.buildReport({ routes: [DEAL], now: now(), lang: 'es' });
    expect(r.cards[0].deltaDay).toBeNull();
    expect(r.cards[0].delta7).toBeNull();
    expect(r.cards[0].spark).toBeNull();
    expect(r.kpis.dropped).toBeNull();
    const h = rd.buildReport({ routes: [DEAL], now: now(), lang: 'es', histByKey: hist(DEAL, [1100, 1069]) });
    expect(h.cards[0].deltaDay.label).toBe('\u22123\u00A0%');
    expect(h.kpis.dropped.value).toBe('1');
  });
  test('caption ≤1024, 3 líneas, 2 botones y nombre de archivo', () => {
    const r = rd.buildReport({ routes: [DEAL, ABOVE], now: now(), lang: 'es' });
    const cap = rd.captionFor(r);
    expect(cap.length).toBeLessThanOrEqual(1024);
    expect(cap.split('\n')).toHaveLength(3);
    expect(cap).toContain('1 de 2 rutas están bajo tu tope. Mejor: COR → MAD');
    const kb = rd.keyboardFor(r, { webApp: 'https://app.example/app' });
    expect(kb.inline_keyboard[0].map((b) => b.text)).toEqual(['Ver mejor oferta', 'Mis alertas']);
    expect(kb.inline_keyboard[0][1].web_app.url).toBe('https://app.example/app');
    expect(rd.fileName(r)).toBe('FlightAlert_2026-10-24.pdf');
  });
});

describe('i18n', () => {
  test('es/en/pt completos y sin palabras prohibidas', () => {
    const keys = Object.keys(I18N.es);
    for (const l of ['en', 'pt']) expect(Object.keys(I18N[l]).sort()).toEqual(keys.slice().sort());
    const all = JSON.stringify(I18N).toLowerCase();
    for (const w of ['en vivo', 'tiempo real', '24/7', 'real time', 'real-time', 'live', 'ao vivo', 'tempo real']) expect(all).not.toContain(w);
  });
  test.each([['es', 'Informe Pro', 'sábado'], ['en', 'Pro Report', 'Saturday'], ['pt', 'Relatório Pro', 'sábado']])('%s', (lang, brand, day) => {
    const r = rd.buildReport({ routes: [DEAL, STALE], user: { firstName: 'A' }, now: now(), lang });
    expect(r.brand).toBe(brand);
    expect(r.date.toLowerCase()).toContain(day.toLowerCase());
    const text = JSON.stringify(strip(r)).toLowerCase();
    for (const w of ['en vivo', 'tiempo real', '24/7']) expect(text).not.toContain(w);
  });
  test('fecha en hora Argentina (23:30 ART sigue siendo el mismo día)', () => {
    const late = new Date('2026-10-25T02:30:00Z');
    expect(rd.longDate(late, 'es')).toContain('24 de octubre');
  });
});

describe('render PDF', () => {
  test.each([['con ofertas', [DEAL, ABOVE]], ['mixto', [DEAL, ABOVE, STALE, NEVER]], ['todo vacío', [STALE, NEVER]]])('%s: PDF válido < 300 KB', async (_, routes) => {
    const r = rd.buildReport({ routes, user: { firstName: 'Emilio' }, now: now(), lang: 'es', histByKey: hist(DEAL, [1100, 1080, 1069]), links: { edit: 'https://x/e', manage: 'https://x/m' } });
    const buf = await renderReport(r);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeLessThan(300 * 1024);
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBe(Math.max(1, Math.ceil(routes.length / 3)));
  });
  test('RSS acotado: 30 renders seguidos', async () => {
    const routes = [DEAL, ABOVE, STALE, NEVER, DEAL, ABOVE];
    const r = rd.buildReport({ routes, now: now(), lang: 'es', histByKey: hist(DEAL, [1100, 1080, 1069]) });
    for (let i = 0; i < 10; i += 1) await renderReport(r); // calentamiento: el RSS se estabiliza
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 30; i += 1) await renderReport(r);
    const grew = (process.memoryUsage().rss - before) / 1024 / 1024;
    expect(grew).toBeLessThan(128);
    expect(process.memoryUsage().rss / 1024 / 1024).toBeLessThan(512);
  });
});

async function seedUser(id, routes, lang = 'es') {
  await col('Entitlement').create({ telegramUserId: String(id), plan: 'pro', searchesUsed: 0, proUntil: '2026-12-31T00:00:00Z', telegramChatId: String(id) });
  await col('User').create({ telegramUserId: String(id), lang, firstName: 'U' });
  for (const r of routes) await col('Route').create({ ...r, _id: undefined, telegramUserId: String(id), paused: false });
}

describe('envío diario', () => {
  test('flag apagado: mismo flujo de texto de antes, sin PDF', async () => {
    await seedUser(1, [DEAL]);
    await daily.runDailyDigest({});
    expect(notifier.sendDocument).not.toHaveBeenCalled();
    expect(notifier.send.mock.calls[0][2]).toMatch(/^Informe — .*\nAlertas activas: 1\nOrden: precio, escalas, duración y fecha\.$/);
    expect(notifier.send.mock.calls[1][3].reply_markup.inline_keyboard[0][0].text).toBe('Ver en Aviasales');
  });
  test('flag encendido: sendDocument con caption, 2 botones y archivo', async () => {
    process.env.FEATURE_REPORT_PDF = 'on';
    process.env.PUBLIC_BASE_URL = 'https://fa.example';
    await seedUser(1, [DEAL]);
    const out = await daily.runDailyDigest({});
    expect(out.sent).toBe(1);
    const [, chat, buf, opts, file] = notifier.sendDocument.mock.calls[0];
    expect(chat).toBe('1');
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    expect(opts.caption.split('\n')).toHaveLength(3);
    expect(file).toEqual({ filename: 'FlightAlert_2026-10-24.pdf', contentType: 'application/pdf' });
    expect(notifier.send).not.toHaveBeenCalled();
  });
  test('si el render falla → texto de respaldo', async () => {
    process.env.FEATURE_REPORT_PDF = 'on';
    daily.setRenderer(async () => { throw new Error('boom'); });
    await seedUser(1, [ABOVE], 'en');
    await daily.runDailyDigest({});
    expect(notifier.sendDocument).not.toHaveBeenCalled();
    expect(notifier.send.mock.calls[0][2]).toContain('none is under your cap');
    expect(notifier.send.mock.calls[1][2]).toContain('ROS → MAD');
  });
  test('búsqueda en vivo con presupuesto global: tope Duffel total y concurrencia', async () => {
    process.env.FEATURE_REPORT_PDF = 'on';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    process.env.DIGEST_DUFFEL_MAX = '4';
    process.env.DIGEST_CONCURRENCY = '2';
    routeAxios(450);
    let active = 0; let peak = 0;
    axios.post.mockImplementation(async () => { active += 1; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active -= 1; return offer(450); });
    const months = ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
    for (let i = 0; i < 5; i += 1) await seedUser(10 + i, [{ origin: 'ROS', destination: 'MAD', tripType: 'oneway', flexMonth: months[i], outboundDate: `${months[i]}-01`, priceThreshold: 500 }]);
    // Dos usuarios con la misma ruta comparten la búsqueda.
    await seedUser(20, [{ origin: 'ROS', destination: 'MAD', tripType: 'oneway', flexMonth: '2026-11', outboundDate: '2026-11-01', priceThreshold: 500 }]);
    const out = await daily.runDailyDigest({});
    expect(out.sent).toBe(6);
    expect(axios.post.mock.calls.length).toBeLessThanOrEqual(4);
    expect(out.stats.duffelReserved).toBeLessThanOrEqual(4);
    expect(out.stats.live).toBe(5);
    expect(peak).toBeLessThanOrEqual(3 * 2);
    const saved = await col('Route').find({ telegramUserId: '10' }).lean();
    expect(saved[0].lastPriceEur).toBeGreaterThan(0);
    expect(saved[0].source).toBe('duffel');
    expect((await col('PriceHistory').find({}).lean()).length).toBeGreaterThan(0);
  });
  test('timeout por ruta: no cuelga la corrida', async () => {
    process.env.FEATURE_REPORT_PDF = 'on';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    process.env.DIGEST_ROUTE_TIMEOUT_MS = '50';
    routeAxios();
    axios.post.mockImplementation(() => new Promise(() => {}));
    await seedUser(1, [{ origin: 'ROS', destination: 'MAD', tripType: 'oneway', flexMonth: '2026-12', outboundDate: '2026-12-01', priceThreshold: 500 }]);
    const t = Date.now();
    const out = await daily.runDailyDigest({});
    expect(Date.now() - t).toBeLessThan(3000);
    expect(out.stats.timeouts).toBe(1);
    expect(notifier.sendDocument).toHaveBeenCalledTimes(1);
    expect(notifier.sendDocument.mock.calls[0][3].caption).toContain('Hoy no hubo precios nuevos');
  });
});

describe('tick de alertas guarda el mejor precio siempre', () => {
  test('arriba del tope: no avisa, pero guarda precio y PriceHistory (1 fila por día, mínimo)', async () => {
    process.env.FEATURE_INSTANT_ALERTS = 'on';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios(450);
    await col('Entitlement').create({ telegramUserId: '1', plan: 'pro', searchesUsed: 0, proUntil: '2026-12-31T00:00:00Z' });
    await col('Route').create({ telegramUserId: '1', origin: 'ROS', destination: 'MAD', tripType: 'oneway', flexMonth: '2026-12', outboundDate: '2026-12-01', priceThreshold: 100, paused: false });
    await instant.run({ sendMessage: jest.fn() });
    const r = await col('Route').findOne({ telegramUserId: '1' });
    expect(r.lastPriceEur).toBeGreaterThan(100);
    expect(r.source).toBe('duffel');
    expect(r.checkedAt).toBe(NOW);
    expect(r.instantLastAt || null).toBeNull();
    duffel.reset();
    axios.post.mockImplementation(async () => offer(300));
    clock.setNow(new Date(Date.parse(NOW) + 3 * HOUR));
    await instant.run({ sendMessage: jest.fn() });
    const rows = await col('PriceHistory').find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].minPrice).toBe(Math.round(300));
    expect(new Date(rows[0].expiresAt).getTime() - Date.parse(NOW) - 3 * HOUR).toBe(35 * 864e5);
  });
});
