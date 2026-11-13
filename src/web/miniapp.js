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
const { activeDestinations, pairOk } = require('../config/airports');
const { pairAllowed } = require('../config/coverage');
const places = require('../bot/ux/places');
const travelpayouts = require('../providers/travelpayouts');
const { runSearch } = require('../services/search');
const { bookingUrl } = require('../bot/deepLinks');
const { ageMs } = require('../services/sortFlights');
const entitlements = require('../services/entitlements');
const flags = require('../config/flags');
const plans = require('../config/plans');
const suggest = require('../services/suggest');
const funnel = require('../services/funnel');
const logger = require('../utils/logger').child('miniapp');

const PUBLIC = path.join(__dirname, '..', '..', 'public', 'app');
function assetVer(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC, file))).digest('hex').slice(0, 8);
  } catch { return '1'; }
}
const ASSET_VER = { css: assetVer('app.css'), js: assetVer('app.js') };
const FONTS_DIR = path.join(__dirname, '..', '..', 'public', 'fonts');
const FONT_WHITELIST = new Set([
  'inter-latin-wght-normal.woff2',
  'jetbrains-mono-latin-wght-normal.woff2',
]);
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
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

function html(nonce, lang, botUser = '') {
  const cleanBot = String(botUser || '').replace(/^@/, '').replace(/[^A-Za-z0-9_]/g, '');
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>Flight Alert</title>
<link rel="stylesheet" href="/app/app.css?v=${ASSET_VER.css}">
<script nonce="${nonce}" src="https://telegram.org/js/telegram-web-app.js"></script>
</head>
<body data-bot="${cleanBot}">
<main id="root" aria-live="polite"><p class="muted">…</p></main>
<script nonce="${nonce}" src="/app/app.js?v=${ASSET_VER.js}" defer></script>
</body>
</html>`;
}

function langOfReq(req) {
  const al = String(req.headers['accept-language'] || '');
  if (/^en/i.test(al)) return 'en';
  if (/^pt/i.test(al)) return 'pt-BR';
  return 'es';
}

/** Envuelve handlers async: un throw/reject se loguea y responde 500 {error:'api'} (nunca cuelga la request). */
function safe(fn) {
  return (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch((err) => {
    logger.error(`api ${req.method} ${req.path}`, err);
    if (!res.headersSent) res.status(500).json({ error: 'api' });
  });
}

function auth(req, res, next) {
  const raw = req.get('X-Telegram-Init-Data') || '';
  const v = initData.validate(raw, process.env.TELEGRAM_BOT_TOKEN, { now: clock.now().getTime() });
  if (!v.ok) return res.status(401).json({ error: 'unauthorized' });
  req.tgUser = v.user;
  return next();
}

function placesPayload() {
  const item = (code, extra = {}) => {
    const p = places.PLACES[code] || { city: code, country: '', alias: [] };
    return { code, label: places.label(code), city: p.city, country: p.country, alias: p.alias || [], airport: p.airport || '', ...extra };
  };
  const cov = require('../config/coverage');
  const latam = cov.latamOriginsAvailable();
  const hubs = cov.euHubsAvailable();
  const euAll = cov.euOriginsAvailable();
  // "Vuelta desde Europa": hubs primero (los muestra el selector), el resto se encuentra escribiendo.
  const euOrigins = [...hubs, ...euAll.filter((c) => !hubs.includes(c))].map((c) => item(c, { eu: true, hub: hubs.includes(c) }));
  const ret = latam.filter((o) => euAll.some((e) => cov.pairAllowed(e, o))).map((c) => item(c, { ret: true }));
  return {
    origins: latam.map((c) => item(c)).concat(euOrigins),
    destinations: activeDestinations().filter((d) => latam.some((o) => cov.pairAllowed(o, d))).map((c) => item(c)).concat(ret),
    euHubs: hubs,
  };
}

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
  return pairOk(o, d) && pairAllowed(o, d);
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
    returnDate: r.returnDate || null,
    flexMonth: r.flexMonth || null,
    stayDays: r.stayDays || null,
    notify: r.notify || 'daily',
    ceiling: r.priceThreshold || null,
    ceilingSource: r.ceilingSource || null,
    currency: r.currency || 'EUR',
    lastPrice: r.lastPriceEur || null,
    seen_at: r.foundAt || null,
    paused: !!r.paused,
    pausedByBilling: Boolean(r.pausedByBilling),
    pausedReason: r.pausedReason || null,
    version: Number(r.version || 1),
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
  const api = (m, p, ...h) => r[m](p, ...h.map(safe));
  r.param('id', (req, res, next, id) => (validId(id) ? next() : res.status(400).json({ error: 'bad_id' })));
  const nonceOf = (res) => res.locals.cspNonce || crypto.randomBytes(16).toString('hex');

  r.get('/', (req, res) => {
    const nonce = nonceOf(res);
    res.set('Content-Security-Policy', csp(nonce));
    res.set('Cache-Control', 'no-store');
    res.type('html').send(html(nonce, langOfReq(req), process.env.TELEGRAM_BOT_USERNAME || ''));
  });
  for (const file of ['app.js', 'app.css']) {
    r.get(`/${file}`, (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.type(file.endsWith('.js') ? 'application/javascript' : 'text/css').send(fs.readFileSync(path.join(PUBLIC, file)));
    });
  }
  r.get('/fonts/:file', (req, res) => {
    const file = String(req.params.file || '');
    if (!FONT_WHITELIST.has(file)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.type('font/woff2').send(fs.readFileSync(path.join(FONTS_DIR, file)));
  });

  r.use('/api', auth);
  api('get', '/api/me', async (req, res) => {
    const id = req.tgUser.id;
    const pro = await entitlements.isPro(id);
    const pInfo = await entitlements.planOf(id);
    const activeAlerts = await entitlements.activeAlertsOf(id);
    const alertCap = entitlements.maxAlertsFor(pInfo.plan);
    const entDoc = await col('Entitlement').findOne({ telegramUserId: String(id) }).lean();
    const gate = pInfo.plan === 'pro' ? null : await entitlements.peek(id);
    const inst = await entitlements.instantQuotaState(id);
    const lc = String(req.tgUser.language_code || '').toLowerCase();
    const lang = lc.startsWith('es') ? 'es' : (lc.startsWith('pt') ? 'pt' : 'en');
    const searchCap = pInfo.plan === 'pro' ? null : entitlements.SEARCH_CAP;
    res.json({
      id: String(id),
      lang,
      plan: pInfo.plan,
      pro,
      proUntil: entDoc && entDoc.proUntil ? entDoc.proUntil : null,
      trialUsed: Boolean(entDoc && entDoc.trialUsedAt),
      trialEndsAt: entDoc && entDoc.trialEndsAt ? entDoc.trialEndsAt : null,
      safeMode: plans.isSafeMode(),
      left: gate ? Math.max(0, entitlements.SEARCH_CAP - (gate.used || 0)) : null,
      quota: {
        alerts: { used: activeAlerts.length, cap: alertCap },
        searches: { used: gate ? (gate.used || 0) : 0, cap: searchCap },
        instant: inst,
      },
      features: {
        mp: flags.mp(),
        stars: flags.stars(),
        alerts: flags.alerts(),
      },
      botUsername: String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, ''),
    });
  });
  api('get', '/api/plans', (_req, res) => {
    const cfg = plans.current();
    const h = plans.health();
    res.json({
      safeMode: plans.isSafeMode(),
      source: h.source,
      checkIntervalMin: cfg.checkIntervalMin,
      free: cfg.free,
      trial: cfg.trial,
      pro: cfg.pro,
    });
  });
  api('get', '/api/suggest', async (req, res) => {
    const o = String(req.query.o || '').toUpperCase();
    const d = String(req.query.d || '').toUpperCase();
    if (!validRoute(o, d)) return res.status(400).json({ error: 'bad_request' });
    const t = req.query.t === '2' || req.query.t === 'roundtrip' ? 'roundtrip' : 'oneway';
    const out = await suggest.suggestPrice({ origin: o, destination: d, tripType: t });
    res.json(out);
  });
  api('get', '/api/places', (_req, res) => res.json(placesPayload()));
  api('get', '/api/calendar', async (req, res) => {
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
  api('post', '/api/search', async (req, res) => {
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
    if (out.paywall) return res.status(402).json({ error: { code: 'PAYWALL', limit: out.limit ?? entitlements.SEARCH_CAP } });
    if (out.status !== 200) return res.status(out.status).json({ error: 'unavailable', text: out.text });
    const now = clock.now();
    const myRoutes = (await col('Route').find({ telegramUserId: String(req.tgUser.id), origin: o, destination: d }).lean())
      .filter((rt) => !rt.paused && !rt.deletedAt);
    const list = (out.results || []).filter((x) => ageMs(x.foundAt, now) <= WEEK).slice(0, 10).map((x) => {
      const c = card(x, adults);
      const exact = myRoutes.find((rt) => rt.outboundDate === x.departureDate && (rt.returnDate || null) === (x.returnDate || null))
        || myRoutes.find((rt) => rt.flexMonth === 'next3' || (rt.flexMonth && x.departureDate && x.departureDate.startsWith(rt.flexMonth)));
      return { ...c, existingAlertId: exact ? String(exact._id) : null };
    });
    res.json({ results: list });
  });

  api('get', '/api/alerts', async (req, res) => {
    const raw = await col('Route').find({ telegramUserId: String(req.tgUser.id) }).lean();
    const list = raw.filter((x) => !x.deletedAt);
    const { plan } = await entitlements.planOf(req.tgUser.id);
    const cap = entitlements.maxAlertsFor(plan);
    const used = list.filter((x) => !x.paused).length;
    res.json({
      items: list.map(alertView),
      used,
      cap,
      plan,
      safeMode: plans.isSafeMode(),
    });
  });
  api('post', '/api/alerts', async (req, res) => {
    const id = String(req.tgUser.id);
    const idemKey = String(req.get('Idempotency-Key') || '').trim().slice(0, 128);
    if (idemKey) {
      const hit = await col('IdempotencyRecord').findOne({
        telegramUserId: id,
        method: 'POST',
        path: '/api/alerts',
        key: idemKey,
      }).lean();
      if (hit && (!hit.expiresAt || new Date(hit.expiresAt).getTime() > clock.now().getTime())) {
        return res.status(hit.status || 200).json(hit.body);
      }
    }
    const b = req.body || {};
    const o = String(b.o || b.origin || '').toUpperCase();
    const d = String(b.d || b.destination || '').toUpperCase();
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    const dep = String(b.dep || b.outboundDate || '');
    const ret = b.ret || b.returnDate ? String(b.ret || b.returnDate) : null;
    const rawC = b.ceiling == null ? null : Number(b.ceiling);
    if (
      !validRoute(o, d)
      || !iso.test(dep)
      || (ret && (!iso.test(ret) || ret <= dep))
      || (rawC !== null && (!Number.isFinite(rawC) || rawC < 50 || rawC > 9999))
    ) {
      return res.status(400).json({ error: 'bad_request' });
    }
    const ceilingSource = b.ceilingSource === 'suggested'
      ? 'suggested'
      : (rawC !== null || b.ceilingSource === 'manual' ? 'manual' : null);
    const notify = b.notify === 'drop' || (b.notify !== 'daily' && rawC !== null) ? 'drop' : 'daily';
    const flexMonth = b.flexMonth === 'next3' || /^\d{4}-\d{2}$/.test(String(b.flexMonth || '')) ? String(b.flexMonth) : null;
    const stayDays = Number.isInteger(Number(b.stayDays)) && Number(b.stayDays) >= 1 && Number(b.stayDays) <= 90 ? Number(b.stayDays) : null;

    const lc = String((req.tgUser && req.tgUser.language_code) || '').toLowerCase();
    const userLang = ['es', 'en', 'pt'].includes(String(b.lang || ''))
      ? String(b.lang)
      : (lc.startsWith('es') ? 'es' : (lc.startsWith('pt') ? 'pt' : 'en'));
    const user = await col('User').findOne({ telegramUserId: id }).lean();
    const chatId = user && user.telegramChatId ? user.telegramChatId : id;
    const opened = await require('../bot/handlers/nuevaAlerta').gate(id, chatId, { lang: userLang });
    if (!opened.ok) {
      const status = opened.status || 402;
      return res.status(status).json({
        error: {
          code: opened.code || 'PAYWALL',
          plan: opened.plan || null,
          cap: opened.cap ?? null,
          active: opened.active ?? null,
          text: opened.text,
        },
        text: opened.text,
      });
    }
    const doc = {
      telegramUserId: id,
      telegramChatId: String(chatId),
      origin: o,
      destination: d,
      tripType: ret ? 'roundtrip' : 'oneway',
      outboundDate: dep,
      returnDate: ret,
      flexMonth,
      stayDays,
      notify,
      priceThreshold: rawC !== null ? Math.round(rawC) : null,
      ceilingSource,
      currency: 'EUR',
      hour: '21:00',
      paused: false,
      pausedByBilling: false,
      pausedReason: null,
      version: 1,
      name: `${o}→${d}`,
      lang: userLang,
    };
    const created = await col('Route').create(doc);
    const fromHeader = String(req.get('X-FA-From') || '').toLowerCase();
    const sessionId = funnel.validSessionId(req.get('X-FA-Session-Id'));
    await funnel.record({
      event: fromHeader === 'search' ? 'alert_create_from_search' : 'alert_create',
      userId: id,
      plan: opened.plan || null,
      outcome: 'created',
      sessionId,
    });
    const payload = {
      ok: true,
      id: String(created && created._id ? created._id : ''),
      item: alertView(created),
    };
    if (idemKey) {
      await col('IdempotencyRecord').create({
        telegramUserId: id,
        method: 'POST',
        path: '/api/alerts',
        key: idemKey,
        status: 200,
        body: payload,
        expiresAt: new Date(clock.now().getTime() + IDEMPOTENCY_TTL_MS),
      }).catch((err) => {
        if (!err || err.code !== 11000) logger.warn('idempotency save failed', { error: err && err.message });
      });
    }
    res.json(payload);
  });
  api('get', '/api/alerts/:id/series', async (req, res) => {
    const found = await col('Route').findOne({ _id: req.params.id, telegramUserId: String(req.tgUser.id) }).lean();
    if (!found || found.deletedAt) return res.status(404).json({ error: 'not_found' });
    const raw = await suggest.getAlertSeries(found, 30);
    const points = raw.map((p) => ({ day: p.obsDate, price: p.min, currency: found.currency || 'EUR' }));
    const status = points.length >= 2 ? 'ok' : (points.length === 1 ? 'cold' : 'none');
    res.json({
      alertId: String(found._id),
      origin: found.origin,
      destination: found.destination,
      ceiling: found.priceThreshold || null,
      points,
      status,
    });
  });
  api('post', '/api/alerts/:id/pause', async (req, res) => {
    const paused = !!(req.body && req.body.paused);
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q).lean();
    if (!found || found.deletedAt) return res.status(404).json({ error: 'not_found' });
    logger.info('legacy_api', { endpoint: 'POST /app/api/alerts/:id/pause', userId: String(req.tgUser.id) });
    if (!paused && found.paused) {
      const verdict = await entitlements.canCreateOrReactivate(req.tgUser.id);
      if (!verdict.ok) {
        return res.status(verdict.status).json({
          error: {
            code: verdict.code,
            plan: verdict.plan || null,
            cap: verdict.cap ?? null,
            active: verdict.active ?? null,
          },
        });
      }
    }
    await col('Route').updateOne(q, {
      $set: {
        paused,
        pausedByBilling: paused ? Boolean(found.pausedByBilling) : false,
        pausedReason: paused ? 'user' : null,
      },
      $inc: { version: 1 },
    });
    res.json({ ok: true, paused });
  });
  api('patch', '/api/alerts/:id', async (req, res) => {
    const b = req.body || {};
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q).lean();
    if (!found || found.deletedAt) return res.status(404).json({ error: 'not_found' });

    const ifMatchRaw = req.get('If-Match') ?? b.version;
    if (ifMatchRaw !== undefined && ifMatchRaw !== null && String(ifMatchRaw).trim() !== '') {
      const expected = Number(String(ifMatchRaw).replace(/^W\//i, '').replace(/["']/g, '').trim());
      const currentVer = Number(found.version || 1);
      if (!Number.isInteger(expected) || expected !== currentVer) {
        return res.status(409).json({
          error: { code: 'VERSION_CONFLICT', version: currentVer },
        });
      }
    }

    const keys = Object.keys(b);
    if (keys.length === 1 && keys[0] === 'ceiling') {
      logger.info('legacy_api', { endpoint: 'PATCH /app/api/alerts/:id', userId: String(req.tgUser.id) });
    }

    const updates = {};
    if ('ceiling' in b) {
      if (b.ceiling === null) {
        updates.priceThreshold = null;
      } else {
        const c = Number(b.ceiling);
        if (!Number.isFinite(c) || c < 50 || c > 9999) return res.status(400).json({ error: 'bad_ceiling' });
        updates.priceThreshold = Math.round(c);
      }
    }
    if ('ceilingSource' in b) {
      if (!['manual', 'suggested', null].includes(b.ceilingSource)) return res.status(400).json({ error: 'bad_ceiling_source' });
      updates.ceilingSource = b.ceilingSource;
    }
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if ('outboundDate' in b) {
      if (!iso.test(String(b.outboundDate || ''))) return res.status(400).json({ error: 'bad_date' });
      updates.outboundDate = String(b.outboundDate);
    }
    if ('returnDate' in b) {
      if (b.returnDate === null) {
        updates.returnDate = null;
      } else {
        const rd = String(b.returnDate || '');
        const depRef = updates.outboundDate || found.outboundDate;
        if (!iso.test(rd) || (depRef && rd <= depRef)) return res.status(400).json({ error: 'bad_date' });
        updates.returnDate = rd;
      }
    }
    if ('tripType' in b) {
      if (!['oneway', 'roundtrip'].includes(b.tripType)) return res.status(400).json({ error: 'bad_trip_type' });
      updates.tripType = b.tripType;
    }
    if ('flexMonth' in b) {
      if (b.flexMonth !== null && b.flexMonth !== 'next3' && !/^\d{4}-\d{2}$/.test(String(b.flexMonth || ''))) {
        return res.status(400).json({ error: 'bad_flex_month' });
      }
      updates.flexMonth = b.flexMonth;
    }
    if ('stayDays' in b) {
      if (b.stayDays !== null && (!Number.isInteger(Number(b.stayDays)) || Number(b.stayDays) < 1 || Number(b.stayDays) > 90)) {
        return res.status(400).json({ error: 'bad_stay_days' });
      }
      updates.stayDays = b.stayDays === null ? null : Number(b.stayDays);
    }
    if ('notify' in b) {
      if (!['daily', 'drop'].includes(b.notify)) return res.status(400).json({ error: 'bad_notify' });
      updates.notify = b.notify;
    }
    if ('paused' in b) {
      const nextPaused = Boolean(b.paused);
      if (!nextPaused && found.paused) {
        const verdict = await entitlements.canCreateOrReactivate(req.tgUser.id);
        if (!verdict.ok) {
          return res.status(verdict.status).json({
            error: {
              code: verdict.code,
              plan: verdict.plan || null,
              cap: verdict.cap ?? null,
              active: verdict.active ?? null,
            },
          });
        }
        updates.paused = false;
        updates.pausedByBilling = false;
        updates.pausedReason = null;
      } else if (nextPaused) {
        updates.paused = true;
        updates.pausedReason = 'user';
      } else {
        updates.paused = false;
      }
    }

    await col('Route').updateOne(q, { $set: updates, $inc: { version: 1 } });
    const updated = await col('Route').findOne(q).lean();
    res.json({
      ok: true,
      ceiling: updated ? updated.priceThreshold : null,
      item: updated ? alertView(updated) : null,
    });
  });
  api('delete', '/api/alerts/:id', async (req, res) => {
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q).lean();
    if (!found || found.deletedAt) return res.status(404).json({ error: 'not_found' });
    await col('Route').updateOne(q, {
      $set: { deletedAt: clock.now().toISOString(), paused: true },
      $inc: { version: 1 },
    });
    res.json({ ok: true });
  });
  api('post', '/api/alerts/:id/restore', async (req, res) => {
    const q = { _id: req.params.id, telegramUserId: String(req.tgUser.id) };
    const found = await col('Route').findOne(q).lean();
    if (!found) return res.status(404).json({ error: 'not_found' });
    if (!found.deletedAt) return res.json({ ok: true, item: alertView(found) });
    const verdict = await entitlements.canCreateOrReactivate(req.tgUser.id);
    if (!verdict.ok) {
      return res.status(verdict.status).json({
        error: {
          code: verdict.code,
          plan: verdict.plan || null,
          cap: verdict.cap ?? null,
          active: verdict.active ?? null,
        },
      });
    }
    await col('Route').updateOne(q, {
      $set: { deletedAt: null, paused: false, pausedByBilling: false, pausedReason: null },
      $inc: { version: 1 },
    });
    const updated = await col('Route').findOne(q).lean();
    res.json({ ok: true, item: alertView(updated) });
  });
  api('post', '/api/test/plan', async (req, res) => {
    if (process.env.NODE_ENV === 'production') return res.status(404).json({ error: 'not_found' });
    const allow = String(process.env.TEST_USER_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
    const id = String(req.tgUser.id);
    if (allow.length && !allow.includes(id)) return res.status(403).json({ error: 'forbidden' });
    const plan = String((req.body && req.body.plan) || '');
    if (!['free', 'trial', 'pro'].includes(plan)) return res.status(400).json({ error: 'bad_plan' });
    const now = clock.now();
    const set = { plan, telegramUserId: id };
    if (plan === 'pro') {
      set.proUntil = new Date(now.getTime() + entitlements.PRO_DAYS * entitlements.DAY_MS).toISOString();
      set.trialEndsAt = null;
    } else if (plan === 'trial') {
      set.trialUsedAt = now.toISOString();
      set.trialEndsAt = new Date(now.getTime() + entitlements.TRIAL_DAYS * entitlements.DAY_MS).toISOString();
      set.proUntil = null;
    } else {
      set.proUntil = null;
      set.trialEndsAt = null;
    }
    await col('Entitlement').updateOne({ telegramUserId: id }, { $set: set }, { upsert: true });
    res.json({ ok: true, plan });
  });
  return r;
}

module.exports = { router, validId, enabled, csp, heat, monthOf, calendar, placesPayload, _calCache: calCache, FONT_WHITELIST };
