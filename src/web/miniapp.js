'use strict';

/**
 * Mini App de Telegram (spec PRISM v2, P0.3 a P0.6). HTML + JS propio, sin CDNs salvo
 * telegram-web-app.js de telegram.org, que se agrega a la CSP solo en /app.
 * Toda la API valida initData (header X-Telegram-Init-Data); el user.id sale de ahí, nunca del body.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const initData = require('./initData');
const clock = require('../utils/clock');
const { col } = require('../database');
const { ORIGINS, DESTINATIONS } = require('../config/airports');
const { pairAllowed } = require('../config/coverage');
const places = require('../bot/ux/places');
const travelpayouts = require('../providers/travelpayouts');
const { runSearch } = require('../services/search');
const { bookingUrl } = require('../bot/deepLinks');
const { ageMs } = require('../services/sortFlights');
const entitlements = require('../services/entitlements');
const logger = require('../utils/logger').child('miniapp');

const PUBLIC = path.join(__dirname, '..', '..', 'public', 'app');
const CAL_TTL = 30 * 60 * 1000;
const calCache = new Map();
const WEEK = 7 * 24 * 3600 * 1000;

function csp(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://telegram.org`,
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // La Mini App se abre dentro de Telegram (iframe en Web/Desktop).
    'frame-ancestors https://web.telegram.org https://*.telegram.org',
    "form-action 'self'",
  ].join('; ');
}

function html(nonce, lang) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Flight Alert</title>
<link rel="stylesheet" href="/app/app.css">
<script nonce="${nonce}" src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body>
<main id="root" aria-live="polite"><p class="muted">…</p></main>
<script nonce="${nonce}" src="/app/app.js" defer></script>
</body>
</html>`;
}

function langOfReq(req) {
  return /^en/i.test(String(req.headers['accept-language'] || '')) ? 'en' : 'es';
}

function auth(req, res, next) {
  const raw = req.get('X-Telegram-Init-Data') || '';
  const v = initData.validate(raw, process.env.TELEGRAM_BOT_TOKEN, { now: clock.now().getTime() });
  if (!v.ok) return res.status(401).json({ error: 'unauthorized' });
  req.tgUser = v.user;
  return next();
}

function placesPayload() {
  const item = (code) => {
    const p = places.PLACES[code] || { city: code, country: '', alias: [] };
    return { code, label: places.label(code), city: p.city, country: p.country, alias: p.alias || [], airport: p.airport || '' };
  };
  return { origins: ORIGINS.map(item), destinations: DESTINATIONS.map(item) };
}

/** "2611" → "2026-11". */
function monthOf(code) {
  const m = /^(\d{2})(\d{2})$/.exec(String(code || ''));
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `20${m[1]}-${m[2]}`;
}

/** Terciles sobre precios reales: barato / medio / caro. Días sin dato no se devuelven (gris en la app). */
function heat(days) {
  // Terciles por rango: el tercio más barato es "cheap", el más caro "high".
  const prices = days.map((d) => d.price).sort((a, b) => a - b);
  const n = prices.length;
  if (n < 3) return days.map((d) => ({ ...d, level: 'mid' }));
  return days.map((d) => {
    const rank = prices.indexOf(d.price);
    return { ...d, level: rank < n / 3 ? 'cheap' : rank >= (2 * n) / 3 ? 'high' : 'mid' };
  });
}

async function calendar(o, d, month, oneway) {
  const key = `${o}|${d}|${month}|${oneway ? 1 : 2}`;
  const hit = calCache.get(key);
  const now = clock.now();
  if (hit && now.getTime() - hit.at < CAL_TTL) return hit.days;
  const today = now.toISOString().slice(0, 10);
  const rows = await travelpayouts.searchRange({ origin: o, destination: d, months: [month], from: today, oneway });
  const best = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.price) || r.price <= 0 || ageMs(r.foundAt, now) > WEEK) continue;
    const cur = best.get(r.departureDate);
    if (!cur || r.price < cur.price) best.set(r.departureDate, { day: r.departureDate, price: r.price, currency: r.currency || 'EUR', seen_at: r.foundAt });
  }
  const days = heat([...best.values()].sort((a, b) => (a.day < b.day ? -1 : 1)));
  calCache.set(key, { at: now.getTime(), days });
  if (calCache.size > 500) calCache.delete(calCache.keys().next().value);
  return days;
}

function validRoute(o, d) {
  return ORIGINS.includes(o) && DESTINATIONS.includes(d) && pairAllowed(o, d);
}

function card(x, adults) {
  return {
    origin: x.origin,
    destination: x.destination,
    departureDate: x.departureDate,
    returnDate: x.returnDate || null,
    price: x.price,
    currency: x.currency || 'EUR',
    stops: x.stops,
    seen_at: x.foundAt,
    url: bookingUrl(x, { adults }),
  };
}

function alertView(r) {
  return {
    id: String(r._id),
    origin: r.origin,
    destination: r.destination,
    tripType: r.tripType,
    outboundDate: r.outboundDate || null,
    flexMonth: r.flexMonth || null,
    ceiling: r.priceThreshold || null,
    currency: r.currency || 'EUR',
    lastPrice: r.lastPriceEur || null,
    seen_at: r.foundAt || null,
    paused: !!r.paused,
  };
}

// ObjectId de Mongo (24 hex). Sin MONGODB_URI (local/tests) la base en memoria usa m<n>.
function validId(id) {
  const v = String(id || '');
  if (/^[a-f0-9]{24}$/i.test(v)) return true;
  return !process.env.MONGODB_URI && /^m\d{1,9}$/.test(v);
}

function enabled(env = process.env) {
  return String(env.MINIAPP_ENABLED || 'true').toLowerCase() !== 'false';
}

function router() {
  const r = express.Router();
  // MINIAPP_ENABLED=false: todo /app y /app/api/* responde 404.
  r.use((_req, res, next) => (enabled() ? next() : res.status(404).type('text/plain').send('Not found')));
  r.param('id', (req, res, next, id) => (validId(id) ? next() : res.status(400).json({ error: 'bad_id' })));
  const nonceOf = (res) => res.locals.cspNonce || crypto.randomBytes(16).toString('hex');

  r.get('/', (req, res) => {
    const nonce = nonceOf(res);
    res.set('Content-Security-Policy', csp(nonce));
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html(nonce, langOfReq(req)));
  });
  for (const file of ['app.js', 'app.css']) {
    r.get(`/${file}`, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type(file.endsWith('.js') ? 'application/javascript' : 'text/css').send(fs.readFileSync(path.join(PUBLIC, file)));
    });
  }

  r.use('/api', auth);
  r.get('/api/me', async (req, res) => {
    const id = req.tgUser.id;
    const pro = await entitlements.isPro(id);
    const gate = pro ? null : await entitlements.peek(id);
    res.json({ lang: String(req.tgUser.language_code || '').startsWith('es') ? 'es' : 'en', pro, left: gate ? Math.max(0, entitlements.SEARCH_CAP - (gate.used || 0)) : null });
  });
  r.get('/api/places', (_req, res) => res.json(placesPayload()));
  r.get('/api/calendar', async (req, res) => {
    const o = String(req.query.o || '').toUpperCase();
    const d = String(req.query.d || '').toUpperCase();
    const month = monthOf(req.query.m);
    if (!validRoute(o, d) || !month) return res.status(400).json({ error: 'bad_request' });
    try {
      res.json(await calendar(o, d, month, String(req.query.t || '1') !== '2'));
    } catch (err) {
      logger.error('calendar', err);
      res.status(502).json({ error: 'api' });
    }
  });
  r.post('/api/search', async (req, res) => {
    const b = req.body || {};
    const o = String(b.o || '').toUpperCase();
    const d = String(b.d || '').toUpperCase();
    const dep = String(b.dep || '');
    const ret = b.ret ? String(b.ret) : null;
    const adults = Math.min(9, Math.max(1, Math.floor(Number(b.adults) || 1)));
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const today = clock.now().toISOString().slice(0, 10);
    if (!validRoute(o, d) || !iso.test(dep) || dep < today || (ret && (!iso.test(ret) || ret <= dep))) return res.status(400).json({ error: 'bad_request' });
    const flexMonth = b.flex === true;
    const query = {
      origin: o, destination: d, months: [dep.slice(0, 7)], day: flexMonth ? null : dep, from: today,
      oneway: !ret, returnDate: flexMonth ? null : ret, stay: null,
    };
    const out = await runSearch(req.tgUser.id, query);
    if (out.apiError) return res.status(502).json({ error: 'api' });
    if (out.paywall) return res.status(402).json({ error: 'paywall' });
    if (out.status !== 200) return res.status(out.status).json({ error: 'unavailable', text: out.text });
    const now = clock.now();
    const list = (out.results || []).filter((x) => ageMs(x.foundAt, now) <= WEEK).slice(0, 10).map((x) => card(x, adults));
    res.json({ results: list });
  });

  r.get('/api/alerts', async (req, res) => {
    const list = await col('Route').find({ telegramUserId: String(req.tgUser.id) }).lean();
    res.json(list.map(alertView));
  });
  r.post('/api/alerts', async (req, res) => {
    const b = req.body || {};
    const o = String(b.o || '').toUpperCase();
    const d = String(b.d || '').toUpperCase();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const dep = String(b.dep || '');
    const ret = b.ret ? String(b.ret) : null;
    const c = b.ceiling == null ? null : Number(b.ceiling);
    if (!validRoute(o, d) || !iso.test(dep) || (ret && !iso.test(ret)) || (c !== null && !(c >= 50 && c <= 9999))) return res.status(400).json({ error: 'bad_request' });
    const id = req.tgUser.id;
    const user = await col('User').findOne({ telegramUserId: String(id) });
    const chatId = user && user.telegramChatId ? user.telegramChatId : String(id);
    const opened = await require('../bot/handlers/nuevaAlerta').gate(id, chatId);
    if (!opened.ok) return res.status(402).json({ error: 'paywall', text: opened.text });
    const doc = {
      telegramUserId: String(id), telegramChatId: String(chatId), origin: o, destination: d,
      tripType: ret ? 'roundtrip' : 'oneway', outboundDate: dep, returnDate: ret, flexMonth: null, stayDays: null,
      notify: c ? 'drop' : 'daily', priceThreshold: c ? Math.round(c) : null, currency: 'EUR', hour: '21:00', paused: false, name: `${o}→${d}`,
    };
    const created = await col('Route').create(doc);
    res.json({ ok: true, id: String(created && created._id ? created._id : '') });
  });
  r.post('/api/alerts/:id/pause', async (req, res) => {
    const paused = !!(req.body && req.body.paused);
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q);
    if (!found) return res.status(404).json({ error: 'not_found' });
    await col('Route').updateOne(q, { $set: { paused } });
    res.json({ ok: true, paused });
  });
  r.patch('/api/alerts/:id', async (req, res) => {
    const c = Number(req.body && req.body.ceiling);
    if (!Number.isFinite(c) || c < 50 || c > 9999) return res.status(400).json({ error: 'bad_ceiling' });
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q);
    if (!found) return res.status(404).json({ error: 'not_found' });
    await col('Route').updateOne(q, { $set: { priceThreshold: Math.round(c) } });
    res.json({ ok: true, ceiling: Math.round(c) });
  });
  r.delete('/api/alerts/:id', async (req, res) => {
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q);
    if (!found) return res.status(404).json({ error: 'not_found' });
    await col('Route').deleteMany(q);
    res.json({ ok: true });
  });
  return r;
}

module.exports = { router, validId, enabled, csp, heat, monthOf, calendar, placesPayload, _calCache: calCache };
