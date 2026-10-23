'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn().mockResolvedValue([]) }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const rateLimit = require('../src/services/rateLimit');
const visits = require('../src/services/visits');
const { createApp } = require('../src/app');

const UA = 'Mozilla/5.0 (Macintosh) Chrome/130 Safari/537.36';
const flush = () => new Promise((r) => setTimeout(r, 30));
let server; let base;

beforeAll(async () => {
  cleanEnv(); reset();
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
beforeEach(() => { reset(); rateLimit.reset(); clock.reset(); });

const hit = (path, ip, headers = {}) => fetch(base + path, { headers: { 'X-Forwarded-For': ip, 'User-Agent': UA, Accept: 'text/html', ...headers } });
const today = async () => col('VisitDay').findOne({ day: visits.dayKey(clock.now()) });

test('cuenta pageviews y únicos de páginas públicas', async () => {
  await hit('/es', '203.0.113.1');
  await hit('/es', '203.0.113.1');
  await hit('/pro', '203.0.113.2', { Referer: 'https://www.google.com/search?q=x' });
  await hit('/en?utm_source=Twitter', '203.0.113.3');
  await flush();
  const d = await today();
  expect(d.pageviews).toBe(4);
  expect(d.uniques).toBe(3);
  const pages = visits.bucket(d, 'pages');
  expect(pages['/es']).toBe(2);
  expect(visits.bucket(d, 'refs')['google_com']).toBe(1);
  expect(visits.bucket(d, 'utm').twitter).toBe(1);
});

test('no cuenta bots, health, webhooks, estáticos, admin ni api', async () => {
  await hit('/', '203.0.113.9', { 'User-Agent': 'Googlebot/2.1' });
  await hit('/health', '203.0.113.9');
  await hit('/robots.txt', '203.0.113.9');
  await hit('/public/x.css', '203.0.113.9');
  await hit('/admin', '203.0.113.9');
  await hit('/api/sample-price', '203.0.113.9');
  await flush();
  expect(await today()).toBeFalsy();
});

test('nunca guarda la IP ni el UA', async () => {
  await hit('/es', '198.51.100.77');
  await flush();
  const all = JSON.stringify([await today(), await col('VisitSeen').find({}).lean()]);
  expect(all).not.toContain('198.51.100.77');
  expect(all).not.toContain('Chrome/130');
});

test('el hash rota por día', () => {
  expect(visits.visitorHash('1.2.3.4', UA, '2026-10-22')).not.toBe(visits.visitorHash('1.2.3.4', UA, '2026-10-23'));
});

test('si la base falla, la página responde igual', async () => {
  const spy = jest.spyOn(require('../src/database'), 'col').mockImplementation(() => { throw new Error('db caída'); });
  const res = await hit('/es', '203.0.113.5');
  await flush();
  spy.mockRestore();
  expect(res.status).toBe(200);
});

test('statsText y todayLine resumen el agregado', async () => {
  await visits.record({ ip: '1.1.1.1', ua: UA, path: '/es', referer: '', host: 'x', utm: '' });
  await visits.record({ ip: '1.1.1.2', ua: UA, path: '/pro', referer: 'https://t.co/a', host: 'x', utm: '' });
  const text = await visits.statsText();
  expect(text).toContain('Hoy: 2 vistas · 2 únicos');
  expect(text).toContain('/es — 1');
  expect(text).toContain('t_co — 1');
  expect(await visits.todayLine()).toBe('Visitas hoy: 2 vistas · 2 únicos');
});

test('referrer propio no cuenta como fuente; sin referrer es direct', () => {
  expect(visits.refDomain('https://flightalert.ranuk.dev/es', 'flightalert.ranuk.dev')).toBeNull();
  expect(visits.refDomain('', 'x')).toBe('direct');
});
