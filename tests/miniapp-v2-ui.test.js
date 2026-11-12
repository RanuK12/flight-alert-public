'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const suggest = require('../src/services/suggest');
const { createApp } = require('../src/app');

function authFor(user) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify(user),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function req(app, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const raw = body ? JSON.stringify(body) : null;
      const r = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          ...headers,
          ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => {
            const buf = Buffer.concat(chunks);
            const text = buf.toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* */ }
            resolve({ status: res.statusCode, headers: res.headers, text, json, buf });
          });
        });
      });
      r.on('error', reject);
      if (raw) r.write(raw);
      r.end();
    });
  });
}

beforeEach(() => {
  cleanEnv();
  reset();
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
  process.env.TELEGRAM_BOT_USERNAME = 'flightalertpro_bot';
});

afterEach(() => cleanEnv());

describe('Mini App F2 UI, CSP, fuentes propias, branding SVG, presupuesto gzip y /series + /restore', () => {
  test('bundle gzip de app.js + app.css pesa <= 60 KB', () => {
    const jsGz = zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.js'))).length;
    const cssGz = zlib.gzipSync(fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.css'))).length;
    expect(jsGz + cssGz).toBeLessThanOrEqual(60 * 1024);
  });

  test('/app sirve CSP estricta (font-src self), bot data attr, y app.js/css contienen SVG avioncito + Ranuk IT + ranuk.dev sin avatar.webp', async () => {
    const app = createApp();
    const res = await req(app, 'GET', '/app');
    expect(res.status).toBe(200);
    const csp = String(res.headers['content-security-policy'] || '');
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(res.text).toContain('data-bot="flightalertpro_bot"');
    expect(res.text).not.toContain('avatar.webp');

    const jsRes = await req(app, 'GET', '/app/app.js');
    expect(jsRes.status).toBe(200);
    expect(jsRes.text).toContain('#64ffda');
    expect(jsRes.text).toContain('ranuk.dev');
    expect(jsRes.text).toContain('Hecho por Ranuk IT');
    expect(jsRes.text).not.toContain('avatar.webp');

    const font1 = await req(app, 'GET', '/app/fonts/inter-latin-wght-normal.woff2');
    const font2 = await req(app, 'GET', '/app/fonts/jetbrains-mono-latin-wght-normal.woff2');
    expect(font1.status).toBe(200);
    expect(font1.buf.length).toBeGreaterThan(1000);
    expect(font2.status).toBe(200);
    expect(font2.buf.length).toBeGreaterThan(1000);

    const traversal = await req(app, 'GET', '/app/fonts/..%2F..%2Fpackage.json');
    expect(traversal.status).toBe(404);
  });

  test('app.css y app.js cumplen Opción B (.cta-main), allowlist de startapp, sparkline /series, VER PRO y Undo 30s', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.css'), 'utf8');
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.js'), 'utf8');
    expect(css).toMatch(/text-transform:\s*uppercase/);
    expect(css).toContain('.cta-main');
    expect(css).toContain('inter-latin-wght-normal.woff2');
    expect(css).toContain('jetbrains-mono-latin-wght-normal.woff2');
    expect(js).toContain('routeStartParam');
    expect(js).toContain('pro_search_paywall');
    expect(js).toContain('/restore');
    expect(js).toContain('/series');
    expect(js).toContain('cta-main');
    expect(js).toContain('ranuk.dev');
    expect(js).toContain('openTelegramLink');
  });

  test('GET /app/api/alerts/:id/series y POST /app/api/alerts/:id/restore funcionan para el dueño', async () => {
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501 }) };
    const route = await col('Route').create({
      telegramUserId: '501',
      origin: 'EZE',
      destination: 'MAD',
      tripType: 'roundtrip',
      outboundDate: '2026-12-10',
      priceThreshold: 650,
      paused: false,
      deletedAt: new Date(),
    });
    for (let i = 1; i <= 5; i += 1) {
      await suggest.recordObservation({
        origin: 'EZE', destination: 'MAD', tripType: 'roundtrip', obsDate: `2026-10-0${i}`, price: 700 - i * 10,
      });
    }

    // Alerta borrada devuelve 404 en /series hasta restaurarla con POST /restore
    const deletedSeries = await req(app, 'GET', `/app/api/alerts/${route._id}/series`, h);
    expect(deletedSeries.status).toBe(404);

    const rest = await req(app, 'POST', `/app/api/alerts/${route._id}/restore`, h);
    expect(rest.status).toBe(200);
    expect(rest.json.ok).toBe(true);
    expect(rest.json.item.paused).toBe(false);
    expect((await col('Route').findOne({ _id: route._id })).deletedAt || null).toBeNull();

    const sRes = await req(app, 'GET', `/app/api/alerts/${route._id}/series`, h);
    expect(sRes.status).toBe(200);
    expect(sRes.json.points).toHaveLength(5);
    expect(sRes.json.ceiling).toBe(650);
  });
});
