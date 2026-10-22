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

test('seo-routes.json: 10 rutas AR→EU válidas, títulos ≤60 y descripciones ≤155', () => {
  expect(routes).toHaveLength(10);
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
  expect(new Set(paths).size).toBe(20);
});

test('sitemap.xml lista home, /pro y las 20 páginas de ruta con hreflang', async () => {
  const res = await get(createApp(), '/sitemap.xml');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/xml/);
  expect(res.body).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
  for (const p of ['/', '/es', '/en', '/pro', '/vuelos/buenos-aires-madrid', '/en/flights/buenos-aires-madrid']) {
    expect(res.body).toContain(`<loc>https://flightalert.ranuk.dev${p}</loc>`);
  }
  expect((res.body.match(/<url>/g) || []).length).toBe(1 + 2 + 1 + 20);
  expect(res.body).toContain('hreflang="en" href="https://flightalert.ranuk.dev/en/flights/buenos-aires-rome"');
});

test('robots.txt tiene la línea Sitemap', async () => {
  const res = await get(createApp(), '/robots.txt');
  expect(res.body).toContain('Sitemap: https://flightalert.ranuk.dev/sitemap.xml');
  expect(res.body).toContain('Disallow: /admin');
});

test('página de ruta ES: title, h1, canonical, hreflang, JSON-LD y sin número sin datos', async () => {
  const res = await get(createApp(), '/vuelos/buenos-aires-madrid');
  expect(res.status).toBe(200);
  const b = res.body;
  expect(b).toContain('<title>Vuelos baratos Buenos Aires-Madrid | Flight Alert</title>');
  expect(b).toContain('<h1>Vuelos de Buenos Aires a Madrid</h1>');
  expect(b).toContain('rel="canonical" href="https://flightalert.ranuk.dev/vuelos/buenos-aires-madrid"');
  expect(b).toContain('hreflang="en" href="https://flightalert.ranuk.dev/en/flights/buenos-aires-madrid"');
  expect(b).toContain('"@type":"FAQPage"');
  expect(b).toContain('"@type":"BreadcrumbList"');
  expect(b).not.toContain('{PRECIO}');
  expect(b).toContain('data-state="empty"');
  expect(b).not.toMatch(/€\s?\d/);
  expect(res.headers['cache-control']).toBe(seo.HTML_CACHE);
});

test('página de ruta EN con precio real del caché', async () => {
  await col('Route').create({ telegramUserId: '1', origin: 'EZE', destination: 'FCO', lastPriceEur: 61.4, foundAt: new Date() });
  const res = await get(createApp(), '/en/flights/buenos-aires-rome');
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
  expect(run('GET', '/vuelos/buenos-aires-madrid')).toBe(seo.HTML_CACHE);
  expect(run('GET', '/es')).toBe(seo.HTML_CACHE);
  for (const p of ['/admin', '/app/api/search', '/webhooks/mp', '/pro/checkout', '/app']) {
    expect(run('GET', p)).toBeUndefined();
  }
  expect(run('POST', '/pro/checkout')).toBeUndefined();
  expect(run('GET', '/es', true)).toBeUndefined();
});

test('medios de pago salen de los flags, iguales en landing y /pro', async () => {
  process.env.FEATURE_PAYMENTS_STRIPE = 'on';
  process.env.FEATURE_PAYMENTS_STARS = 'on';
  const pro = await get(createApp(), '/pro');
  expect(pro.body).toContain('Medios de pago: Tarjeta (Stripe) · Estrellas de Telegram.');
  expect(pro.body).not.toContain('solo con estrellas');
  const home = await get(createApp(), '/es');
  expect(home.body).toContain('Tarjeta (Stripe) · Estrellas de Telegram');
  expect(home.body).not.toContain('Stripe · Mercado Pago · Stars');
});

test('/pro muestra precio y prueba reales del código', async () => {
  const pricing = require('../src/config/pricing');
  const ent = require('../src/services/entitlements');
  const res = await get(createApp(), '/pro?pais=ES');
  expect(res.body).toContain(`€${pricing.figure(pricing.PRO_EUR_CENTS, 'es')} por mes`);
  expect(res.body).toContain(`${ent.TRIAL_DAYS} días gratis`);
});

test('el copy de búsquedas gratis coincide con el tope real', () => {
  const ent = require('../src/services/entitlements');
  for (const r of routes) expect(r.es.intro).toContain(`${ent.SEARCH_CAP} búsquedas al mes`);
});

test('rutas: todas salen de un origen AR y van a un destino de airports.js', () => {
  const { ORIGINS, DESTINATIONS } = require('../src/config/airports');
  for (const r of routes) {
    expect(ORIGINS).toContain(r.origen_iata);
    expect(DESTINATIONS).toContain(r.destino_iata);
  }
});

test('URLs retiradas: 301 a la home del idioma y fuera del sitemap', async () => {
  const es = await get(createApp(), '/vuelos/madrid-paris');
  expect(es.status).toBe(301);
  expect(es.headers.location).toBe('/');
  const en = await get(createApp(), '/en/flights/madrid-rome');
  expect(en.status).toBe(301);
  expect(en.headers.location).toBe('/en');
  const sm = await get(createApp(), '/sitemap.xml');
  expect(sm.text || sm.body).not.toContain('madrid-paris');
  expect(sm.text || sm.body).toContain('/vuelos/cordoba-madrid');
  for (const r of seo.ROUTES) expect(seo.REMOVED.has(r.path.es) || seo.REMOVED.has(r.path.en)).toBe(false);
});
