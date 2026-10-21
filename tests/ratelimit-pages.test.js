'use strict';

jest.mock('../src/database', () => ({ health: () => ({ ok: true, db: 'up' }), col: () => ({}), open: () => {}, connect: async () => {} }));

const { createApp } = require('../src/app');
const rateLimit = require('../src/services/rateLimit');

beforeEach(() => rateLimit.reset());

let server;
let base;
beforeAll(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const hit = (path, ip, opts = {}) => fetch(base + path, { ...opts, headers: { 'X-Forwarded-For': ip, ...(opts.headers || {}) } });

test('la home aguanta una ráfaga de 60 pedidos y corta pasado 120', async () => {
  for (let i = 0; i < 60; i += 1) {
    const res = await hit('/', '203.0.113.7');
    expect(res.status).not.toBe(429);
  }
  let last;
  for (let i = 0; i < 70; i += 1) last = await hit('/', '203.0.113.7');
  expect(last.status).toBe(429);
});

test('los webhooks no pasan por el límite por IP', async () => {
  for (let i = 0; i < 30; i += 1) {
    const res = await hit('/webhooks/mp', '203.0.113.8', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).not.toBe(429);
  }
});

test('la landing en /es y /en usa la misma ráfaga que la home', async () => {
  for (const path of ['/es', '/en']) {
    let last;
    for (let i = 0; i < 25; i += 1) last = await hit(path, '203.0.113.11');
    expect(last.status).not.toBe(429);
  }
});

test('otras rutas siguen con 20 por minuto', async () => {
  let last;
  for (let i = 0; i < 25; i += 1) last = await hit('/no-existe', '203.0.113.9');
  expect(last.status).toBe(429);
});
