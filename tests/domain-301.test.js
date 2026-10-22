'use strict';

const express = require('express');
const http = require('http');
const { legacyRedirect, baseUrl, CANONICAL } = require('../src/config/site');

function app() {
  const a = express();
  a.use(legacyRedirect);
  a.use((_req, res) => res.status(200).send('ok'));
  return a;
}

function call(server, method, path, host) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request({ port, method, path, headers: { host } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res));
    });
    req.on('error', reject);
    req.end(method === 'POST' ? '{}' : undefined);
  });
}

describe('301 desde onrender', () => {
  let server;
  beforeAll((done) => { server = app().listen(0, () => done()); });
  afterAll((done) => { server.close(() => done()); });
  const OLD = 'flight-alert-public.onrender.com';

  test('GET de página en host viejo → 301 con path y query', async () => {
    const r = await call(server, 'GET', '/pro?s=abc&x=1', OLD);
    expect(r.statusCode).toBe(301);
    expect(r.headers.location).toBe(`${CANONICAL}/pro?s=abc&x=1`);
  });
  test('/health no redirige', async () => {
    expect((await call(server, 'GET', '/health', OLD)).statusCode).toBe(200);
  });
  test.each(['/webhooks/telegram', '/webhooks/stripe', '/webhooks/mp'])('POST %s no redirige', async (p) => {
    expect((await call(server, 'POST', p, OLD)).statusCode).toBe(200);
  });
  test('POST a otra ruta no redirige', async () => {
    expect((await call(server, 'POST', '/pro/checkout', OLD)).statusCode).toBe(200);
  });
  test('host canónico no redirige', async () => {
    expect((await call(server, 'GET', '/pro', 'flightalert.ranuk.dev')).statusCode).toBe(200);
  });
});

describe('baseUrl', () => {
  test('sin PUBLIC_BASE_URL usa el canónico', () => expect(baseUrl({})).toBe(CANONICAL));
  test('host viejo se reemplaza', () => expect(baseUrl({ PUBLIC_BASE_URL: 'https://flight-alert-public.onrender.com/' })).toBe(CANONICAL));
  test('otro valor se respeta', () => expect(baseUrl({ PUBLIC_BASE_URL: 'https://x.test/' })).toBe('https://x.test'));
});
