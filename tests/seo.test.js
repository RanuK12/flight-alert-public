'use strict';

const http = require('http');

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(), put: jest.fn() }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const { createApp } = require('../src/app');
const seo = require('../src/web/seo');
const routes = require('../data/seo-routes.json');

function get(app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      http.get({ port: server.address().port, path: urlPath, headers: { 'accept-encoding': 'identity' } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })));
      }).on('error', reject);
    });
  });
}

beforeEach(() => {
  cleanEnv();
  reset();
  if (rateLimit.reset) rateLimit.reset();
  process.env.PUBLIC_BASE_URL = 'https://flightalert.ranuk.dev';
});

test('seo-routes.json: 20 rutas válidas, títulos ≤60 y descripciones ≤155', () => {
  expect(routes).toHaveLength(20);
  for (const r of routes) {
    expect(r.origen_iata).toMatch(/^[A-Z]{3}$/);
    expect(r.destino_iata).toMatch(/^[A-Z]{3}$/);
    for (const lang of ['es', 'en']) {
      const t = r[lang];
      expect(t.title.length).toBeLessThanOrEqual(60);
      expect(seo.fill(t.meta_description, null, lang).length).toBeLessThanOrEqual(155);
      expect(t.h1).toBeTruthy();
      expect(t.intro).toBeTruthy();
      expect(t.faq).toHaveLength(3);
    }
  }
  const paths = seo.ROUTES.flatMap((r) => [r.path.es, r.path.en]);
  expect(new Set(paths).size).toBe(40);
});

test('sitemap.xml lista home, /pro y las 40 páginas de ruta con hreflang', async () => {
  const res = await get(createApp(), '/sitemap.xml');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/xml/);
  expect(res.body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  for (const p of ['/', '/es', '/en', '/pro', '/vuelos/madrid-paris', '/en/flights/madrid-paris']) {
    expect(res.body).toContain(`<loc>https://flightalert.ranuk.dev${p}</loc>`);
  }
  expect((res.body.match(/<url>/g) || []).length).toBe(1 + 2 + 1 + 40);
  expect(res.body).toContain('hreflang="en" href="https://flightalert.ranuk.dev/en/flights/madrid-rome"');
});

test('robots.txt tiene la línea Sitemap', async () => {
  const res = await get(createApp(), '/robots.txt');
  expect(res.body).toContain('Sitemap: https://flightalert.ranuk.dev/sitemap.xml');
  expect(res.body).toContain('Disallow: /admin');
});

test('página de ruta ES: title, h1, canonical, hreflang, JSON-LD y sin número sin datos', async () => {
  const res = await get(createApp(), '/vuelos/madrid-paris');
  expect(res.status).toBe(200);
  const b = res.body;
  expect(b).toContain('<title>Vuelos baratos Madrid-París | Flight Alert</title>');
  expect(b).toContain('<h1>Vuelos de Madrid a París</h1>');
  expect(b).toContain('rel="canonical" href="https://flightalert.ranuk.dev/vuelos/madrid-paris"');
  expect(b).toContain('hreflang="en" href="https://flightalert.ranuk.dev/en/flights/madrid-paris"');
  expect(b).toContain('"@type":"FAQPage"');
  expect(b).toContain('"@type":"BreadcrumbList"');
  expect(b).not.toContain('{PRECIO}');
  expect(b).toContain('data-state="empty"');
  expect(b).not.toMatch(/€\s?\d/);
  expect(res.headers['cache-control']).toBe(seo.HTML_CACHE);
});

test('página de ruta EN con precio real del caché', async () => {
  await col('Route').create({ telegramUserId: '1', origin: 'MAD', destination: 'FCO', lastPriceEur: 61.4, foundAt: new Date() });
  const res = await get(createApp(), '/en/flights/madrid-rome');
  expect(res.status).toBe(200);
  expect(res.body).toContain('<html lang="en">');
  expect(res.body).toContain('€61');
  expect(res.body).toContain('data-state="price"');
});

test('ruta desconocida da 404', async () => {
  const res = await get(createApp(), '/vuelos/nada-nada');
  expect(res.status).toBe(404);
});

test('/pro tiene title, description y hreflang propios', async () => {
  const res = await get(createApp(), '/pro');
  expect(res.body).toContain(`<title>${seo.PRO_META.title}</title>`);
  expect(res.body).toContain('<meta name="description"');
  expect(res.body).toContain('hreflang="es" href="https://flightalert.ranuk.dev/pro"');
});

test('htmlCache: público en HTML, nunca en /admin, /app/api, /webhooks ni checkout', () => {
  const run = (method, p, cookie) => {
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (cookie) headers['Set-Cookie'] = 'x=1';
    const res = { statusCode: 200, set: (k, v) => { headers[k] = v; }, get: (k) => headers[k], send: () => {} };
    seo.htmlCache({ method, path: p }, res, () => {});
    res.send('<html>');
    return headers['Cache-Control'];
  };
  expect(run('GET', '/vuelos/madrid-paris')).toBe(seo.HTML_CACHE);
  expect(run('GET', '/es')).toBe(seo.HTML_CACHE);
  for (const p of ['/admin', '/app/api/search', '/webhooks/mp', '/pro/checkout', '/app']) {
    expect(run('GET', p)).toBeUndefined();
  }
  expect(run('POST', '/pro/checkout')).toBeUndefined();
  expect(run('GET', '/es', true)).toBeUndefined();
});
