'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true) }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const duffel = require('../src/providers/duffel');
const travelpayouts = require('../src/providers/travelpayouts');
const notifier = require('../src/bot/notifier');
const instant = require('../src/services/instantAlerts');
const cov = require('../src/config/coverage');

const HOUR = 3600000;
const NOW = '2026-10-21T15:00:00.000Z'; // 12:00 ART

function offerResponse(amount, currency = 'EUR') {
  return { data: { data: { live_mode: false, offers: [
    { total_amount: String(amount), total_currency: currency, owner: { iata_code: 'IB' }, slices: [{ duration: 'PT14H5M', segments: [{}, {}] }] },
  ] } }, headers: {} };
}
const fxResponse = { data: { rates: { EUR: 0.9 } } };
function routeAxios({ tp = null, amount = 450 } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('frankfurter')) return fxResponse;
    if (url.includes('travelpayouts')) return tp || { data: { data: [] }, headers: {} };
    throw new Error(`url inesperada ${url}`);
  });
  axios.post.mockImplementation(async () => offerResponse(amount));
}
const slicesOf = (i) => axios.post.mock.calls[i][1].data.slices;

let covFile;
beforeEach(() => {
  cleanEnv(); reset(); duffel.reset(); clock.reset();
  clock.setNow(new Date(NOW));
  axios.get.mockReset(); axios.post.mockReset(); notifier.send.mockClear();
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.TRAVELPAYOUTS_TOKEN = 'tp-test';
  covFile = path.join(os.tmpdir(), `cov-range-${process.pid}.json`);
  fs.writeFileSync(covFile, JSON.stringify({
    withData: [{ origin: 'MEX', destination: 'MAD' }],
    withDuffel: [{ origin: 'ROS', destination: 'MAD' }, { origin: 'MEX', destination: 'MAD' }],
    byOrigin: { ROS: { with: 0, total: 1, percent: 0, percentWithDuffel: 100 }, MEX: { with: 1, total: 1, percent: 100, percentWithDuffel: 100 } },
    duffelMethod: cov.DUFFEL_METHOD,
  }));
  process.env.COVERAGE_FILE = covFile;
});
afterEach(() => { cleanEnv(); clock.reset(); try { fs.unlinkSync(covFile); } catch (_) { /* */ } });

const BASE = { origin: 'ROS', destination: 'MAD', months: ['2026-12'], day: null, from: '2026-10-21' };

describe('searchRange: relleno Duffel por mes', () => {
  test('ida: TP vacío → filas de Duffel en días 1/10/20, sin vuelta', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    const rows = await travelpayouts.searchRange({ ...BASE, oneway: true });
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.source === 'duffel')).toBe(true);
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(slicesOf(0)).toEqual([{ origin: 'ROS', destination: 'MAD', departure_date: '2026-12-01' }]);
    expect(slicesOf(2)[0].departure_date).toBe('2026-12-20');
  });
  test('noches fijas: vuelta = ida + stay', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    await travelpayouts.searchRange({ ...BASE, oneway: false, stay: 7, returnDate: null });
    expect(slicesOf(0)).toHaveLength(2);
    expect(slicesOf(0)[1].departure_date).toBe('2026-12-08');
  });
  test('vuelta fija: usa returnDate; sin stay ni vuelta → +14', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    await travelpayouts.searchRange({ ...BASE, oneway: false, returnDate: '2027-01-05', stay: null });
    expect(axios.post.mock.calls.every((c) => c[1].data.slices[1].departure_date === '2027-01-05')).toBe(true);
    axios.post.mockClear(); duffel.reset();
    await travelpayouts.searchRange({ ...BASE, oneway: false, returnDate: null, stay: null });
    expect(slicesOf(0)[1].departure_date).toBe('2026-12-15');
  });
  test('sin Duffel → []', async () => {
    routeAxios();
    expect(await travelpayouts.searchRange({ ...BASE, oneway: true })).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('tope DUFFEL_RANGE_MAX=6 total y fechas ≥ mañana y ≥ from', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    expect(travelpayouts.rangeMax()).toBe(6);
    await travelpayouts.searchRange({ ...BASE, months: ['2026-10', '2026-11', '2026-12', '2027-01'], oneway: true });
    expect(axios.post).toHaveBeenCalledTimes(6);
    const dates = axios.post.mock.calls.map((c) => c[1].data.slices[0].departure_date);
    expect(dates).toEqual(['2026-11-01', '2026-11-10', '2026-11-20', '2026-12-01', '2026-12-10', '2026-12-20']);
    expect(travelpayouts.sampleDates({ months: ['2026-10'], from: '2026-10-21' }, new Date(NOW))).toEqual([]);
    expect(travelpayouts.sampleDates({ months: ['2026-11'], from: '2026-11-05' }, new Date(NOW))).toEqual(['2026-11-10', '2026-11-20']);
  });
  test('TP con datos → no llama a Duffel', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: { data: { data: [{ origin: 'MEX', destination: 'MAD', depart_date: '2026-12-10', value: 480, number_of_changes: 1, found_at: new Date(Date.parse(NOW) - 2 * HOUR).toISOString(), actual: true }] }, headers: {} } });
    const rows = await travelpayouts.searchRange({ ...BASE, origin: 'MEX', oneway: true });
    expect(rows[0].price).toBe(480);
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('regresión ROS-MAD por mes ya no vuelve vacío', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ amount: 610 });
    const rows = await travelpayouts.searchRange({ ...BASE, oneway: false, returnDate: null, stay: null });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ origin: 'ROS', destination: 'MAD', price: 610, source: 'duffel' });
  });
});

describe('alerta instantánea en par solo-Duffel', () => {
  test('ROS-MAD flexible por mes dispara aviso con precio de Duffel', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ amount: 450 });
    await col('Entitlement').create({ telegramUserId: '1', plan: 'pro', searchesUsed: 0, proUntil: '2026-12-31T00:00:00Z' });
    await col('Route').create({ telegramUserId: '1', telegramChatId: '1', origin: 'ROS', destination: 'MAD', tripType: 'oneway', flexMonth: '2026-12', outboundDate: null, returnDate: null, priceThreshold: 500, paused: false });
    const out = await instant.run({});
    expect(out.sent).toBe(1);
    expect(notifier.send.mock.calls[0][2]).toMatch(/€450/);
  });
});
