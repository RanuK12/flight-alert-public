'use strict';

jest.mock('../src/providers/travelpayouts', () => ({
  search: jest.fn(),
}));

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const travelpayouts = require('../src/providers/travelpayouts');
const { runSearch } = require('../src/services/search');
const { col } = require('../src/database');
const { sortFlights } = require('../src/services/sortFlights');

const HOUR = 60 * 60 * 1000;

function hit(query) {
  return {
    origin: query.origin,
    destination: query.destination,
    departureDate: query.departureDate,
    price: 480,
    stops: 0,
    durationMin: 600,
    foundAt: clock.now().toISOString(),
    currency: 'EUR',
  };
}

async function used(id) {
  const doc = await col('Entitlement').findOne({ telegramUserId: String(id) });
  return doc ? doc.searchesUsed : 0;
}

beforeEach(() => {
  cleanEnv();
  reset();
  rateLimit.reset();
  clock.reset();
  process.env.FEATURE_SEARCH = 'on';
  travelpayouts.search.mockReset();
  travelpayouts.search.mockImplementation(async (query) => {
    if (query.departureDate === '2026-01-01') return [];
    return [hit(query)];
  });
});

afterEach(() => cleanEnv());

test('P3. 10 búsquedas, la 11 es paywall, 0 resultados no descuenta, la repetida tampoco', async () => {
  let t = new Date('2026-10-15T15:00:00.000Z').getTime();
  clock.setNow(new Date(t));
  const empty = await runSearch('101', { origin: 'EZE', destination: 'MAD', departureDate: '2026-01-01' });
  expect(empty.status).toBe(200);
  expect(empty.results).toHaveLength(0);
  expect(await used('101')).toBe(0);

  for (let n = 1; n <= 10; n += 1) {
    t += 11 * 1000;
    clock.setNow(new Date(t));
    const day = String(n).padStart(2, '0');
    const res = await runSearch('101', { origin: 'EZE', destination: 'MAD', departureDate: `2026-12-${day}` });
    expect(res.status).toBe(200);
    expect(res.results.length).toBeGreaterThan(0);
  }
  expect(await used('101')).toBe(10);

  t += 11 * 1000;
  clock.setNow(new Date(t));
  const blocked = await runSearch('101', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-20' });
  expect(blocked.paywall).toBe(true);
  expect(await used('101')).toBe(10);

  t += 11 * 1000;
  clock.setNow(new Date(t));
  const again = await runSearch('101', { origin: 'EZE', destination: 'MAD', departureDate: '2026-12-01' });
  expect(again.status).toBe(200);
  expect(again.duplicate).toBe(true);
  expect(await used('101')).toBe(10);
});

test('P4. el cupo se resetea al cambiar de mes en ART', async () => {
  let t = new Date('2026-10-15T18:00:00.000Z').getTime();
  clock.setNow(new Date(t));
  for (let n = 1; n <= 10; n += 1) {
    t += 11 * 1000;
    clock.setNow(new Date(t));
    const day = String(n).padStart(2, '0');
    expect((await runSearch('101', { origin: 'EZE', destination: 'BCN', departureDate: `2026-12-${day}` })).status).toBe(200);
  }
  t += 11 * 1000;
  clock.setNow(new Date(t));
  expect((await runSearch('101', { origin: 'EZE', destination: 'BCN', departureDate: '2026-12-21' })).paywall).toBe(true);

  clock.setNow(new Date('2026-11-01T06:00:00.000Z'));
  const fresh = await runSearch('101', { origin: 'EZE', destination: 'BCN', departureDate: '2026-12-22' });
  expect(fresh.status).toBe(200);
  expect(await used('101')).toBe(1);
});

test('P5. el owner busca 50 veces sin paywall', async () => {
  process.env.OWNER_TELEGRAM_IDS = '777';
  let t = new Date('2026-10-15T15:00:00.000Z').getTime();
  for (let n = 0; n < 50; n += 1) {
    clock.setNow(new Date(t));
    t += 11 * 1000;
    const day = String((n % 27) + 1).padStart(2, '0');
    const month = n < 27 ? '12' : '11';
    const res = await runSearch('777', { origin: 'COR', destination: 'FCO', departureDate: `2026-${month}-${day}` });
    expect(res.paywall).toBeUndefined();
    expect(res.status).toBe(200);
  }
  expect(await used('777')).toBe(0);
});

test('P8. ordena por precio, después escalas, después duración', () => {
  const sorted = sortFlights([
    { price: 600, stops: 1, durationMin: 14 * 60, departureDate: '2026-12-02' },
    { price: 600, stops: 0, durationMin: 12 * 60, departureDate: '2026-12-03' },
    { price: 590, stops: 2, durationMin: 20 * 60, departureDate: '2026-12-01' },
  ]);
  expect(sorted.map((f) => [f.price, f.stops])).toEqual([[590, 2], [600, 0], [600, 1]]);
});

test('P14. la segunda búsqueda dentro de 10 segundos no descuenta', async () => {
  const t = new Date('2026-10-15T15:00:00.000Z');
  clock.setNow(t);
  const first = await runSearch('101', { origin: 'EZE', destination: 'LIS', departureDate: '2026-12-01' });
  expect(first.status).toBe(200);
  clock.setNow(new Date(t.getTime() + 5 * 1000));
  const second = await runSearch('101', { origin: 'EZE', destination: 'LIS', departureDate: '2026-12-02' });
  expect(second.text).toBe('Esperá un toque');
  expect(await used('101')).toBe(1);
  expect(HOUR).toBeGreaterThan(0);
});
