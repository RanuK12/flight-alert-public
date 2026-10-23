'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn().mockResolvedValue([]) }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const runtimeFlags = require('../src/services/runtimeFlags');
const clock = require('../src/utils/clock');

const TOKEN = 'g'.repeat(48);
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
  process.env.ADMIN_TELEGRAM_IDS = '999';
});
afterEach(() => { delete process.env.ADMIN_TOKEN; delete process.env.ADMIN_TELEGRAM_IDS; });

const status = async () => {
  const res = await fetch(`${base}/admin/status`, {
    headers: { Authorization: `Bearer ${TOKEN}`, 'X-Forwarded-For': '198.51.100.7' },
  });
  expect(res.status).toBe(200);
  return res.json();
};

test('status: usuarios nuevos por día ART, alertas activas por origen y enviadas (sin staff)', async () => {
  // Viernes 23/10 21:00 ART = 24/10 00:00 UTC
  clock.setNow(new Date('2026-10-24T00:00:00.000Z'));
  const U = col('User');
  await U.create({ telegramUserId: '1', telegramChatId: '1', createdAt: new Date('2026-10-23T12:00:00.000Z') }); // hoy ART
  await U.create({ telegramUserId: '2', telegramChatId: '2', createdAt: new Date('2026-10-23T02:00:00.000Z') }); // 22/10 23:00 ART
  await U.create({ telegramUserId: '3', telegramChatId: '3', createdAt: new Date('2026-10-17T10:00:00.000Z') }); // hace 6 días
  await U.create({ telegramUserId: '4', telegramChatId: '4', createdAt: new Date('2026-10-12T10:00:00.000Z') }); // hace 11 días
  await U.create({ telegramUserId: '5', telegramChatId: '5', createdAt: new Date('2026-09-01T10:00:00.000Z') }); // fuera de 14 días
  await U.create({ telegramUserId: '999', telegramChatId: '999', createdAt: new Date('2026-10-23T13:00:00.000Z') }); // staff

  const R = col('Route');
  const route = (id, origin, extra = {}) => R.create({ telegramUserId: id, telegramChatId: id, origin, destination: 'MAD', tripType: 'oneway', outboundDate: '2026-12-10', ...extra });
  await route('1', 'EZE');
  await route('2', 'EZE');
  await route('3', 'GRU');
  await route('4', 'COR', { paused: true });
  await route('5', 'ROS', { pausedByBilling: true });
  await route('999', 'EZE');

  const N = col('Notification');
  const note = (id, sentAt) => N.create({ telegramUserId: id, origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10', price: 500, sentAt: new Date(sentAt) });
  await note('1', '2026-10-23T15:00:00.000Z'); // hoy
  await note('2', '2026-10-20T15:00:00.000Z'); // 7d
  await note('3', '2026-10-01T15:00:00.000Z'); // viejo
  await note('999', '2026-10-23T15:00:00.000Z'); // staff

  const j = await status();
  expect(j.newUsers.today).toBe(1);
  expect(j.newUsers.last7d).toBe(3);
  const days = Object.keys(j.newUsers.byDay);
  expect(days).toHaveLength(14);
  expect(days[0]).toBe('2026-10-10');
  expect(days[13]).toBe('2026-10-23');
  expect(j.newUsers.byDay['2026-10-23']).toBe(1);
  expect(j.newUsers.byDay['2026-10-22']).toBe(1);
  expect(j.newUsers.byDay['2026-10-17']).toBe(1);
  expect(j.newUsers.byDay['2026-10-12']).toBe(1);
  expect(Object.values(j.newUsers.byDay).reduce((a, b) => a + b, 0)).toBe(4);

  expect(j.activeAlerts).toEqual({ total: 3, byOrigin: { EZE: 2, GRU: 1 } });
  expect(j.alertsSent).toEqual({ total: 3, today: 1, last7d: 2 });
  expect(JSON.stringify(j)).not.toMatch(/telegramUserId|telegramChatId/);
});

test('status: sin datos devuelve ceros', async () => {
  clock.setNow(new Date('2026-10-21T15:00:00.000Z'));
  const j = await status();
  expect(j.newUsers.today).toBe(0);
  expect(j.newUsers.last7d).toBe(0);
  expect(Object.values(j.newUsers.byDay).every((n) => n === 0)).toBe(true);
  expect(j.activeAlerts).toEqual({ total: 0, byOrigin: {} });
  expect(j.alertsSent).toEqual({ total: 0, today: 0, last7d: 0 });
});
