'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn().mockResolvedValue([]) }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const runtimeFlags = require('../src/services/runtimeFlags');
const flags = require('../src/config/flags');
const clock = require('../src/utils/clock');
const logger = require('../src/utils/logger');

const TOKEN = 'a'.repeat(48);
let server;
let base;

beforeAll(async () => {
  const { createApp } = require('../src/app');
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  cleanEnv();
  reset();
  rateLimit.reset();
  runtimeFlags.reset();
  clock.reset();
  process.env.ADMIN_TOKEN = TOKEN;
});
afterEach(() => { delete process.env.ADMIN_TOKEN; delete process.env.FEATURE_INSTANT_ALERTS; });

const call = (path, { method = 'GET', token = TOKEN, body } = {}) => fetch(base + path, {
  method,
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.9' },
  body: body ? JSON.stringify(body) : undefined,
});

test('sin ADMIN_TOKEN configurado: 404', async () => {
  delete process.env.ADMIN_TOKEN;
  expect((await call('/admin/status')).status).toBe(404);
});

test('sin token o con token incorrecto: 401', async () => {
  expect((await call('/admin/status', { token: null })).status).toBe(401);
  expect((await call('/admin/status', { token: 'b'.repeat(48) })).status).toBe(401);
  expect((await call('/admin/status', { token: TOKEN.slice(0, 10) })).status).toBe(401);
});

test('rate limit en /admin', async () => {
  process.env.ADMIN_RATE_PER_MIN = '3';
  for (let i = 0; i < 3; i += 1) await call('/admin/status', { token: 'x' });
  expect((await call('/admin/status')).status).toBe(429);
  delete process.env.ADMIN_RATE_PER_MIN;
});

test('status: conteos sin datos personales', async () => {
  clock.setNow(new Date('2026-10-21T15:00:00.000Z'));
  await col('User').create({ telegramUserId: '1', telegramChatId: '1' });
  await col('User').create({ telegramUserId: '2', telegramChatId: '2' });
  await col('Entitlement').create({ telegramUserId: '2', plan: 'pro', proUntil: '2026-11-20T00:00:00.000Z' });
  await col('Payment').create({ provider: 'stripe', ref: 'r1', telegramUserId: '2', paidAt: '2026-10-21T14:00:00.000Z' });
  await col('Payment').create({ provider: 'stars', ref: 'r2', telegramUserId: '2', paidAt: '2026-10-21T13:00:00.000Z' });
  await col('Payment').create({ provider: 'mp', ref: 'r3', telegramUserId: '2', paidAt: '2026-10-20T13:00:00.000Z' });
  const res = await call('/admin/status');
  expect(res.status).toBe(200);
  const j = await res.json();
  expect(j.users).toEqual({ total: 2, free: 1, pro: 1, trial: 0 });
  expect(j.paymentsToday).toEqual({ stripe: 1, mp: 0, stars: 1 });
  expect(JSON.stringify(j)).not.toMatch(/telegramUserId|r1|email/);
});

test('kill switch persistido en Mongo y reversible', async () => {
  let res = await call('/admin/kill', { method: 'POST', body: { state: 'on' } });
  expect((await res.json()).kill).toBe(true);
  expect(flags.kill()).toBe(true);
  runtimeFlags.reset();
  await runtimeFlags.refresh(); // simula reinicio
  expect(flags.kill()).toBe(true);
  expect((await fetch(`${base}/pro`, { headers: { 'X-Forwarded-For': '198.51.100.10' } })).status).toBe(503);
  res = await call('/admin/kill', { method: 'POST', body: { state: 'off' } });
  expect((await res.json()).kill).toBe(false);
  expect((await call('/admin/kill', { method: 'POST', body: { state: 'maybe' } })).status).toBe(400);
});

test('override de alertas instantáneas sobre FEATURE_INSTANT_ALERTS', async () => {
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  await call('/admin/instant-alerts', { method: 'POST', body: { state: 'off' } });
  expect(flags.instantAlerts()).toBe(false);
  await call('/admin/instant-alerts', { method: 'POST', body: { state: 'env' } });
  expect(flags.instantAlerts()).toBe(true);
});

test('price-check forzado y con límite', async () => {
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  clock.setNow(new Date('2026-10-21T15:00:00.000Z'));
  const r1 = await call('/admin/price-check', { method: 'POST' });
  expect(r1.status).toBe(200);
  expect((await r1.json()).result).toMatchObject({ calls: 0, sent: 0 });
  await call('/admin/price-check', { method: 'POST' });
  expect((await call('/admin/price-check', { method: 'POST' })).status).toBe(429);
});

test('logs recientes sin secretos', async () => {
  const fakeTg = `${'1234'}${'56789'}:${'ABCdefGHIjklMNOpqrSTUvwxYZ'}abcd_efgh`;
  const fakeSk = `${'sk_'}${'live'}_abcdefghij12345`;
  logger.child('t').info('prueba', { note: `mail ana@example.com token ${fakeTg} ${fakeSk}` });
  const j = await (await call('/admin/logs?n=50')).json();
  const text = j.lines.join('\n');
  expect(text).toMatch(/prueba/);
  expect(text).not.toMatch(/ana@example.com|ABCdefGHI|abcdefghij12345/);
  expect(text).not.toContain(TOKEN);
});

test('logs: n tiene tope de 500', async () => {
  const spy = jest.spyOn(logger, 'recent');
  await call('/admin/logs?n=999999');
  await call('/admin/logs?n=-5');
  expect(spy.mock.calls.map((c) => c[0])).toEqual([500, 1]);
  spy.mockRestore();
});

test('counts usa countDocuments (no carga colecciones)', async () => {
  const { counts } = require('../src/web/admin');
  const now = clock.now();
  const later = new Date(now.getTime() + 86400000).toISOString();
  await col('Entitlement').create({ telegramUserId: '1', plan: 'pro', proUntil: later });
  await col('Entitlement').create({ telegramUserId: '2', plan: 'trial', trialEndsAt: later });
  await col('Payment').create({ provider: 'stars', status: 'paid', paidAt: now.toISOString() });
  await col('Payment').create({ provider: 'stripe', status: 'refunded', paidAt: now.toISOString() });
  const E = col('Entitlement');
  const spy = jest.spyOn(Object.getPrototypeOf(E), 'find');
  const c = await counts();
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
  expect(c.users).toMatchObject({ pro: 1, trial: 1 });
  expect(c.paymentsToday).toEqual({ stripe: 0, mp: 0, stars: 1 });
});
