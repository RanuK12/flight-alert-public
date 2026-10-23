'use strict';

jest.mock('../src/database', () => ({ health: () => ({ ok: true, db: 'up' }), col: () => ({}), open: () => {}, connect: async () => {} }));

const { createApp } = require('../src/app');

let server; let base;
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));
afterEach(() => { process.env.NODE_ENV = 'test'; });

const get = (proto) => fetch(`${base}/health`, { headers: proto ? { 'X-Forwarded-Proto': proto } : {} });

test('producción + HTTPS: manda HSTS de 1 año sin includeSubDomains', async () => {
  process.env.NODE_ENV = 'production';
  const res = await get('https');
  expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
});

test('producción por HTTP: sin HSTS', async () => {
  process.env.NODE_ENV = 'production';
  expect((await get('http')).headers.get('strict-transport-security')).toBeNull();
});

test('fuera de producción: sin HSTS', async () => {
  expect((await get('https')).headers.get('strict-transport-security')).toBeNull();
});
