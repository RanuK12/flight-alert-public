'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

const axios = require('axios');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const country = require('../src/services/country');
const fx = require('../src/services/fx');
const clock = require('../src/utils/clock');
const samplePrice = require('../src/services/samplePrice');
const { ORIGINS, DESTINATIONS } = require('../src/config/airports');
const { createApp } = require('../src/app');
const { renderSampleCard, criticalCss, PRIVACY } = require('../src/web/landing');

const EMPTY_CARD = '<article class="price-card" id="sample-card" data-state="empty"><div class="price-card__header"><p class="route-chip"><abbr title="Ezeiza, Buenos Aires">EZE</abbr> → <abbr title="Madrid">MAD</abbr></p></div><div class="popular-routes-preview"><span class="route-pill is-active"><abbr title="Ezeiza, Buenos Aires">EZE</abbr> → <abbr title="Madrid">MAD</abbr></span><span class="route-pill"><abbr title="Ezeiza, Buenos Aires">EZE</abbr> → <abbr title="Barcelona">BCN</abbr></span><span class="route-pill"><abbr title="Córdoba">COR</abbr> → <abbr title="Fiumicino, Roma">FCO</abbr></span></div><p class="price-card__when">Próximas tarifas monitoreadas</p><div class="price-card__price-row"><p class="price-card__amount"><span class="skeleton-shimmer skeleton-amount"></span></p><svg class="sparkline" viewBox="0 0 100 24" aria-hidden="true" focusable="false"><path d="M2 18 L24 16 L48 19 L72 8 L96 4" fill="none" stroke="#64ffda" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="96" cy="4" r="3" fill="#64ffda"/></svg></div><p class="price-card__words">Revisamos precios cada pocas horas</p><p class="seen"><svg width="16" height="16" aria-hidden="true" focusable="false"><use href="#i-clock"></use></svg> <span class="seen__text">revisamos precios cada pocas horas</span></p><svg class="route-draw" viewBox="0 0 320 80" aria-hidden="true" focusable="false"><path pathLength="1" d="M8 64C70 64 90 16 160 16s90 48 152 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><p class="price-card__source">Precio en caché de Travelpayouts</p><a class="btn" href="https://t.me/flightalertpro_bot?start=landing_hero"><svg width="16" height="16" aria-hidden="true" focusable="false"><use href="#i-tg"></use></svg>Abrir en Telegram</a></article>';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

function get(app, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http.get({ port, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }));
        });
      }).on('error', reject);
    });
  });
}

function post(app, urlPath, form) {
  const body = new URLSearchParams(form).toString();
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const req = http.request({
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => resolve({
            status: res.statusCode,
            location: res.headers.location || '',
            body: Buffer.concat(chunks).toString('utf8'),
          }));
        });
      });
      req.on('error', reject);
      req.end(body);
    });
  });
}

function text(res) {
  if (res.headers['content-encoding'] === 'gzip') return zlib.gunzipSync(res.body).toString('utf8');
  return res.body.toString('utf8');
}

function cardOf(html) {
  const start = html.indexOf('<article class="price-card"');
  const end = html.indexOf('</article>', start);
  return html.slice(start, end + '</article>'.length);
}

beforeEach(() => {
  cleanEnv();
  reset();
  rateLimit.reset();
  country.resetLookup();
  fx.resetFetchers();
  clock.reset();
  samplePrice.reset();
  axios.get.mockReset();
});

afterEach(() => cleanEnv());

test('snapshot de la card vacía, sin precio inventado', () => {
  expect(renderSampleCard(null, 'es')).toBe(EMPTY_CARD);
  expect(EMPTY_CARD).not.toContain('Sin precio reciente');
  expect(EMPTY_CARD).not.toContain('data-value');
  expect(EMPTY_CARD).toContain('EZE');
  expect(EMPTY_CARD).toContain('MAD');
  expect(renderSampleCard(null, 'en')).not.toContain('data-value');
  expect(renderSampleCard(null, 'en')).not.toContain('No recent fare');
});

test('la landing en español sale del config, con privacidad y sin promesas de más', async () => {
  const app = createApp();
  const res = await get(app, '/', { 'accept-language': 'es-AR,es;q=0.9' });
  const html = text(res);
  expect(res.status).toBe(200);
  expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  expect(res.headers['content-security-policy']).toContain('https://tp-em.com');
  expect(res.headers['content-security-policy']).not.toContain('http://tp-em.com');
  expect(html).toContain('rel="canonical" href="/es"');
  expect(html).toContain('hreflang="es" href="/es"');
  expect(html).toContain('hreflang="en" href="/en"');
  expect(html).toContain('hreflang="x-default" href="/es"');
  expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(res.headers['cache-control']).toContain('no-cache');
  const nonce = /'nonce-([a-f0-9]+)'/.exec(res.headers['content-security-policy'])[1];
  expect(html).toContain(`nonce="${nonce}"`);
  expect(html).toContain('lang="es"');
  expect(html).toContain('Vuelos baratos a Europa, sin pasarte el día buscando');
  expect(html).toContain('Abrir en Telegram');
  expect(html).toContain('1 búsqueda gratis · 7 días de prueba de la alerta diaria');
  expect(html).toContain(PRIVACY);
  expect(html).toContain('https://tp-em.com/NTg4ODIz.js?t=588823');
  expect(html).toContain('https://t.me/flightalertpro_bot?start=landing_hero');
  expect(html).toContain('Algunos links son de afiliado');
  expect(html).toContain('Escribinos al bot');
  expect(html).toContain('Datos de Travelpayouts');
  expect(html).not.toContain('Cancelás cuando quieras');
  expect(html).not.toContain('Te avisamos antes');
  expect(html).not.toContain('miles de sitios');
  expect(html).not.toContain('data-value');
  expect(cardOf(html)).toBe(EMPTY_CARD);
  for (const code of [...ORIGINS, ...DESTINATIONS]) {
    expect(html).toContain(`>${code}</abbr>`);
  }
  expect(html.match(/role="tab"/g)).toHaveLength(ORIGINS.length);
  expect(html).toContain('5 orígenes, 31 destinos');
  expect(html).toContain('href="/pro"');
  expect(html).toContain('Quiero Pro');
  const prices = html.slice(html.indexOf('id="precios"'), html.indexOf('id="faq"'));
  expect(prices).not.toContain('<form');
  expect(prices).not.toContain('name="pais"');
  expect(html).toContain('"price":"4.50"');
  expect(html).toContain('"priceCurrency":"USD"');
  expect(html).not.toContain('"priceCurrency":"ARS"');
  const cssPath = html.match(/\/assets\/styles\.[a-f0-9]{10}\.css/)[0];
  const css = await get(app, cssPath);
  expect(css.status).toBe(200);
  expect(css.headers['cache-control']).toContain('immutable');
});

test('inglés por Accept-Language y por /en, español forzado en /es', async () => {
  const app = createApp();
  const en = text(await get(app, '/', { 'accept-language': 'en-US,en;q=0.8' }));
  expect(en).toContain('lang="en"');
  expect(en).toContain('rel="canonical" href="/en"');
  expect(en).toContain('Cheap flights to Europe, without spending all day searching');
  expect(en).toContain('Open in Telegram');
  expect(en).toContain('1 free search · 7-day trial of the daily alert');
  expect(en).toContain('4.50 euros, VAT included.');
  expect(en).toContain(PRIVACY);
  expect(en).toContain('Write to the bot');
  const forced = text(await get(app, '/en', { 'accept-language': 'es-AR' }));
  expect(forced).toContain('lang="en"');
  const es = text(await get(app, '/es', { 'accept-language': 'en' }));
  expect(es).toContain('lang="es"');
  expect(es).toContain('sin pasarte el día buscando');
});

test('ARS solo con cotización real y el país detectado no cambia el checkout', async () => {
  const app = createApp();
  country.setLookup(async () => 'AR');
  const missing = text(await get(app, '/es'));
  expect(missing).toContain('Sin cotización del dólar oficial para mostrar el precio en pesos.');
  expect(missing).not.toContain('pesos argentinos, al dólar oficial de hoy');
  expect(missing).toContain('data-price-region="ar" aria-current="true"');

  await col('FxRate').create({
    publishedArs: 7700,
    usedRate: 1540,
    at: '2026-10-21T00:00:00.000Z',
  });
  const html = text(await get(app, '/es'));
  expect(html).toContain('7700 pesos argentinos, al dólar oficial de hoy.');
  expect(html).toContain('al dólar oficial de hoy');
  expect(html).toContain('"priceCurrency":"ARS"');
  expect(html).toContain('"price":"7700"');
  expect(html).toContain('Este selector solo cambia la vista.');

  country.setLookup(async () => 'ES');
  const eu = text(await get(app, '/es'));
  expect(eu).toContain('data-price-region="eu" aria-current="true"');
  expect(eu).toContain('4,50 euros, IVA incluido.');
  expect(eu).toContain('data-price-region="ar" hidden');
});

test('GET /api/sample-price es de solo lectura y no inventa', async () => {
  const app = createApp();
  const empty = JSON.parse(text(await get(app, '/api/sample-price')));
  expect(empty).toEqual({ ok: true, sample: null });

  const now = new Date('2026-10-21T15:00:00.000Z');
  clock.setNow(now);
  samplePrice.remember({
    origin: 'EZE',
    destination: 'MAD',
    departureDate: '2026-12-01',
    price: 480,
    currency: 'EUR',
    foundAt: new Date(now.getTime() - (2 * HOUR)).toISOString(),
    actual: true,
  });
  const hit = JSON.parse(text(await get(app, '/api/sample-price')));
  expect(hit.sample.price).toBe(480);
  expect(hit.sample.currency).toBe('EUR');
  expect(hit.sample.seen).toBe('visto hace 2 h');
  expect(hit.sample.seenHours).toBe(2);
  const html = text(await get(app, '/es'));
  expect(cardOf(html)).toContain('data-value="480"');
  expect(cardOf(html)).toContain('visto hace 2 h');
  expect(cardOf(html)).toContain('https://t.me/flightalertpro_bot?start=EZE-MAD');
  expect(cardOf(html)).not.toBe(EMPTY_CARD);

  samplePrice.reset();
  clock.setNow(now);
  samplePrice.remember({
    origin: 'EZE',
    destination: 'MAD',
    price: 480,
    currency: 'EUR',
    foundAt: new Date(now.getTime() - (8 * DAY)).toISOString(),
  });
  expect(samplePrice.current()).toBeNull();
  samplePrice.remember({ origin: 'EZE', destination: 'MAD', price: 0, currency: 'EUR', foundAt: now.toISOString() });
  expect(JSON.parse(text(await get(app, '/api/sample-price')))).toEqual({ ok: true, sample: null });
});

test('una búsqueda de Travelpayouts deja la muestra en caché', async () => {
  const now = new Date('2026-10-21T15:00:00.000Z');
  clock.setNow(now);
  process.env.TRAVELPAYOUTS_TOKEN = 'test-token';
  axios.get.mockResolvedValue({
    data: {
      data: [{
        origin: 'EZE',
        destination: 'BCN',
        depart_date: '2026-12-01',
        value: 510,
        number_of_changes: 0,
        found_at: new Date(now.getTime() - (3 * HOUR)).toISOString(),
        actual: true,
      }],
    },
  });
  const travelpayouts = require('../src/providers/travelpayouts');
  const rows = await travelpayouts.search({
    origin: 'EZE',
    destination: 'BCN',
    departureDate: '2026-12-01',
  });
  expect(rows).toHaveLength(1);
  expect(samplePrice.current()).toMatchObject({
    origin: 'EZE',
    destination: 'BCN',
    price: 510,
    seen: 'visto hace 3 h',
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test('POST /pro/checkout sigue igual y /health y los webhooks siguen', async () => {
  const app = createApp();
  const health = await get(app, '/health');
  expect(health.status).toBe(200);
  expect(text(health)).toContain('ok');
  const pro = text(await get(app, '/pro'));
  expect(pro).toContain('action="/pro/checkout"');
  expect(pro).toContain('name="pais"');
  expect(pro).toContain('name="email"');
  const bad = await post(app, '/pro/checkout', { pais: 'ES', email: 'no-es-email' });
  expect(bad.status).toBe(400);
  expect(bad.body).toContain('email');
  const off = await post(app, '/pro/checkout', { pais: 'ES', email: 'ana@ejemplo.com' });
  expect(off.status).toBe(403);
  expect(off.body).toContain('tarjeta');
  const routes = [];
  app._router.stack.forEach((layer) => {
    if (!layer.route) return;
    const method = Object.keys(layer.route.methods)[0];
    routes.push(`${method} ${layer.route.path}`);
  });
  expect(routes).toEqual(expect.arrayContaining([
    'post /webhooks/stripe',
    'post /webhooks/mp',
    'get /health',
    'post /pro/checkout',
    'get /api/sample-price',
  ]));
});

test('el css y el js entran en el presupuesto y el html se comprime', async () => {
  expect(Buffer.byteLength(criticalCss())).toBeLessThan(14 * 1024);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'));
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'));
  expect(zlib.gzipSync(css).length).toBeLessThan(12 * 1024);
  expect(zlib.gzipSync(js).length).toBeLessThan(6 * 1024);
  const app = createApp();
  const res = await get(app, '/es', { 'accept-encoding': 'gzip' });
  expect(res.headers['content-encoding']).toBe('gzip');
  expect(text(res)).toContain('sin pasarte el día buscando');
});

test('el kill switch de la home sigue en mantenimiento', async () => {
  process.env.PUBLIC_KILL_SWITCH = 'on';
  const app = createApp();
  const res = await get(app, '/');
  expect(res.status).toBe(503);
  expect(text(res)).toContain('Estamos en mantenimiento, volvé en un rato');
});

describe('copia honesta y precio desde config', () => {
  const landing = require('../src/web/landing');
  const pricing = require('../src/config/pricing');
  const html = (lang) => {
    for (const k of ['render', 'page', 'landingHtml']) if (typeof landing[k] === 'function') return String(landing[k]({ lang }));
    return '';
  };
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'web', 'landing.js'), 'utf8');
  test('sin promesas de "en vivo", "tiempo real" ni 24/7', () => {
    expect(src).not.toMatch(/En vivo|'Live'|tiempo real|real time|24\/7|badge-live/);
    expect(src).toMatch(/revisamos precios cada pocas horas/i);
    expect(src).toMatch(/we check prices every few hours/i);
  });
  test('sin BNA en la copia y hora en EN sin ART', () => {
    expect(src).not.toMatch(/BNA/);
    expect(src).not.toMatch(/9:00 PM ART/);
    expect(src).toMatch(/9 PM Argentina time/);
  });
  test('sin ítems duplicados de Pro', () => {
    for (const s of ["'Alerta diaria'", "'Resumen a las 21:00'", 'después del cupo', "'Daily alert'", "'9 PM digest'", 'after the monthly cap']) expect(src).not.toContain(s);
  });
  test('el precio en euros sale de config', () => {
    expect(src).not.toMatch(/4[.,]50/);
    expect(pricing.figure(pricing.PRO_EUR_CENTS, 'es')).toBe('4,50');
    expect(pricing.figure(pricing.PRO_EUR_CENTS, 'en')).toBe('4.50');
    void html;
  });
});

test('no-secrets también revisa screenshots/', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'no-secrets.js'), 'utf8');
  expect(src).not.toMatch(/'screenshots'/);
});

test('fotos propias en webp, < 200 KB y con créditos', () => {
  const fs = require('fs'); const path = require('path');
  const credits = fs.readFileSync(path.join(__dirname, '..', 'docs', 'IMAGE_CREDITS.md'), 'utf8');
  for (const n of ['madrid', 'barcelona', 'roma', 'paris', 'lisboa', 'avatar']) {
    const f = path.join(__dirname, '..', 'public', `${n}.webp`);
    expect(fs.statSync(f).size).toBeLessThan(200 * 1024);
    expect(credits).toContain(`public/${n}.webp`);
  }
});
