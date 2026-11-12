'use strict';

const crypto = require('crypto');
const http = require('http');
const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const suggest = require('../src/services/suggest');
const clock = require('../src/utils/clock');
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

function req(app, method, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const r = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* */ }
            resolve({ status: res.statusCode, text, json });
          });
        });
      });
      r.on('error', reject);
      r.end();
    });
  });
}

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
});

afterEach(() => {
  cleanEnv();
  clock.reset();
});

describe('suggest.js & MarketPrice (0, 1-9 cold, >=10 real median*0.85, sin inventar)', () => {
  test('0 días -> none; 1-9 días -> cold; >=10 días -> 0.85 * mediana (mínimo 50 EUR)', async () => {
    expect(await suggest.suggestPrice({ origin: 'EZE', destination: 'MAD', tripType: 'roundtrip' })).toEqual({
      suggested: null, confidence: 'none', samples: 0, currency: 'EUR',
    });

    for (let i = 1; i <= 9; i += 1) {
      await suggest.recordObservation({
        origin: 'EZE', destination: 'MAD', tripType: 'roundtrip', obsDate: `2026-10-0${i}`, price: 800,
      });
    }
    expect(await suggest.suggestPrice({ origin: 'EZE', destination: 'MAD', tripType: 'roundtrip' })).toEqual({
      suggested: null, confidence: 'cold', samples: 9, currency: 'EUR',
    });

    // Mismo día con precio más alto no sube ni duplica muestra; precio menor sí actualiza ($min)
    await suggest.recordObservation({
      origin: 'EZE', destination: 'MAD', tripType: 'roundtrip', obsDate: '2026-10-09', price: 999,
    });
    await suggest.recordObservation({
      origin: 'EZE', destination: 'MAD', tripType: 'roundtrip', obsDate: '2026-10-10', price: 800,
    });
    const ok = await suggest.suggestPrice({ origin: 'EZE', destination: 'MAD', tripType: 'roundtrip' });
    expect(ok).toEqual({
      suggested: 680, confidence: 'ok', samples: 10, currency: 'EUR', median: 800,
    });

    // Piso mínimo de 50 EUR aunque mediana*0.85 sea menor
    for (let i = 1; i <= 10; i += 1) {
      await suggest.recordObservation({
        origin: 'ASU', destination: 'LIS', tripType: 'oneway', obsDate: `2026-10-${String(i).padStart(2, '0')}`, price: 40,
      });
    }
    const floorRes = await suggest.suggestPrice({ origin: 'ASU', destination: 'LIS', tripType: 'oneway' });
    expect(floorRes.suggested).toBe(50);
  });

  test('GET /app/api/suggest y /app/api/alerts/:id/series devuelven puntos reales sin interpolar', async () => {
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501 }) };
    for (let i = 1; i <= 10; i += 1) {
      await suggest.recordObservation({
        origin: 'COR', destination: 'BCN', tripType: 'roundtrip', obsDate: `2026-10-${String(i).padStart(2, '0')}`, price: 700 + i * 10,
      });
    }
    const r = await req(app, 'GET', '/app/api/suggest?o=COR&d=BCN&t=roundtrip', h);
    expect(r.status).toBe(200);
    expect(r.json.confidence).toBe('ok');
    expect(r.json.samples).toBe(10);
    expect(r.json.suggested).toBeGreaterThan(500);

    const series = await suggest.getAlertSeries({ origin: 'COR', destination: 'BCN', tripType: 'roundtrip' });
    expect(series).toHaveLength(10);
    expect(series[0]).toEqual({ obsDate: '2026-10-01', min: 710 });
  });
});
