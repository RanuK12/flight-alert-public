'use strict';

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const entitlements = require('../src/services/entitlements');

beforeEach(() => { cleanEnv(); reset(); clock.reset(); process.env.PRO_SEARCH_PER_DAY = '3'; });
afterEach(() => { delete process.env.PRO_SEARCH_PER_DAY; });

test('reserva Pro atómica: búsquedas concurrentes no pasan el tope', async () => {
  const r = await Promise.all(Array.from({ length: 10 }, () => entitlements.reserveProSearch(77)));
  expect(r.filter(Boolean)).toHaveLength(3);
  const doc = await col('Entitlement').findOne({ telegramUserId: entitlements.idOf ? entitlements.idOf(77) : '77' });
  expect(doc.proSearchesToday).toBe(3);
});

test('release devuelve el cupo y no baja de 0', async () => {
  expect(await entitlements.reserveProSearch(78)).toBe(true);
  await entitlements.releaseProSearch(78);
  await entitlements.releaseProSearch(78);
  const docs = await col('Entitlement').find({}).lean();
  expect(docs.find((d) => String(d.telegramUserId) === '78').proSearchesToday).toBe(0);
});
