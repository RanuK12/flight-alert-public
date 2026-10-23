'use strict';

const crypto = require('crypto');
const express = require('express');
const { col, health } = require('../database');
const clock = require('../utils/clock');
const art = require('../utils/art');
const flags = require('../config/flags');
const rateLimit = require('../services/rateLimit');
const runtimeFlags = require('../services/runtimeFlags');
const logger = require('../utils/logger');

const log = logger.child('admin');

function digest(v) {
  return crypto.createHash('sha256').update(String(v)).digest();
}

/** Comparación en tiempo constante (sobre hashes de largo fijo). */
function tokenOk(given) {
  const expected = process.env.ADMIN_TOKEN || '';
  if (expected.length < 32 || !given) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

function auth(clientIp) {
  return (req, res, next) => {
    // Sin ADMIN_TOKEN configurado, /admin no existe.
    if (!process.env.ADMIN_TOKEN) return res.status(404).type('text/plain').send('Not found');
    const ip = String(clientIp(req));
    if (rateLimit.limited('admin', ip, Number(process.env.ADMIN_RATE_PER_MIN) || 30, 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'rate_limited' });
    }
    const m = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '');
    if (!m || !tokenOk(m[1])) {
      log.warn('admin sin token válido');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
    res.set('Cache-Control', 'no-store');
    return next();
  };
}

function onOff(body) {
  const v = String((body && (body.state ?? body.value ?? body.on)) ?? '').toLowerCase();
  if (['on', 'true', '1', 'yes'].includes(v)) return 'on';
  if (['off', 'false', '0', 'no'].includes(v)) return 'off';
  if (['env', 'default', 'null', 'clear'].includes(v)) return null;
  return undefined;
}

/** countDocuments sin admins/owners: total menos lo que matchea cada ID staff (pocos, desde env). */
async function countReal(C, filter, staff) {
  let n = await C.countDocuments(filter);
  for (const id of staff) n -= await C.countDocuments({ ...filter, telegramUserId: id });
  return Math.max(0, n);
}

async function counts() {
  const nowIso = clock.now().toISOString();
  const E = col('Entitlement');
  // Admins y owners no cuentan en métricas ni revenue.
  const staff = flags.staffIds();
  const pro = await countReal(E, {
    $or: [
      { plan: 'owner' },
      { plan: 'pro', proUntil: { $gt: nowIso } },
      { plan: 'pro', graceUntil: { $gt: nowIso } },
    ],
  }, staff);
  const trial = await countReal(E, { plan: 'trial', trialEndsAt: { $gt: nowIso } }, staff);
  const users = await countReal(col('User'), {}, staff);
  const total = Math.max(users, await countReal(E, {}, staff));
  const sinceIso = art.startOfArtDay(clock.now()).toISOString();
  const today = {};
  for (const provider of ['stripe', 'mp', 'stars']) {
    today[provider] = await countReal(col('Payment'), {
      provider,
      status: { $ne: 'refunded' },
      $or: [{ paidAt: { $gte: sinceIso } }, { paidAt: { $exists: false }, createdAt: { $gte: sinceIso } }],
    }, staff);
  }
  return { users: { total, free: total - pro, pro, trial }, paymentsToday: today };
}

/** Métricas de crecimiento y uso (solo lecturas; staff excluido). Fechas en ART. */
async function growth(staff) {
  const staffSet = new Set(staff.map(String));
  const real = (doc) => !staffSet.has(String(doc.telegramUserId));
  const now = clock.now();
  const todayStart = art.startOfArtDay(now);
  const since7 = new Date(todayStart.getTime() - 6 * art.DAY_MS);

  // Usuarios nuevos: countDocuments por día ART (no carga la colección).
  const U = col('User');
  const byDay = {};
  let new7 = 0;
  for (let i = 13; i >= 0; i -= 1) {
    const from = new Date(todayStart.getTime() - i * art.DAY_MS);
    const to = new Date(from.getTime() + art.DAY_MS);
    const n = await countReal(U, { createdAt: { $gte: from, $lt: to } }, staff);
    byDay[art.parts(from).day] = n;
    if (from >= since7) new7 += n;
  }
  const newToday = byDay[art.parts(todayStart).day];

  // Alertas activas: solo origin + telegramUserId de rutas no pausadas.
  const routes = (await col('Route').find(
    { paused: { $ne: true }, pausedByBilling: { $ne: true } },
    { telegramUserId: 1, origin: 1 },
  ).lean()).filter(real);
  const byOrigin = {};
  for (const r of routes) {
    const o = String(r.origin || '?').toUpperCase();
    byOrigin[o] = (byOrigin[o] || 0) + 1;
  }

  const N = col('Notification');
  const sent = {
    total: await countReal(N, {}, staff),
    today: await countReal(N, { sentAt: { $gte: todayStart } }, staff),
    last7d: await countReal(N, { sentAt: { $gte: since7 } }, staff),
  };

  return {
    newUsers: { today: newToday, last7d: new7, byDay },
    activeAlerts: { total: routes.length, byOrigin },
    alertsSent: sent,
  };
}

function router({ clientIp, priceCheck }) {
  const r = express.Router();
  r.use(auth(clientIp));

  r.get('/status', async (_req, res) => {
    const h = health();
    let data = {};
    try { data = await counts(); } catch (err) { data = { error: 'counts_unavailable' }; }
    try { Object.assign(data, await growth(flags.staffIds())); } catch (err) { data.growthError = 'growth_unavailable'; }
    res.json({
      ok: h.ok,
      db: h.db,
      commit: (process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 12),
      version: require('../../package.json').version,
      uptimeSec: Math.round(process.uptime()),
      now: clock.now().toISOString(),
      kill: flags.kill(),
      instantAlerts: flags.instantAlerts(),
      ai: require('../services/ai').health(),
      overrides: { kill: runtimeFlags.get('kill'), instantAlerts: runtimeFlags.get('instantAlerts') },
      ...data,
    });
  });

  r.post('/kill', async (req, res) => {
    const v = onOff(req.body);
    if (v === undefined) return res.status(400).json({ ok: false, error: 'state must be on|off' });
    await runtimeFlags.set('kill', v === null ? 'off' : v);
    log.warn('kill switch', { state: v });
    res.json({ ok: true, kill: flags.kill() });
  });

  r.post('/instant-alerts', async (req, res) => {
    const v = onOff(req.body);
    if (v === undefined) return res.status(400).json({ ok: false, error: 'state must be on|off|env' });
    await runtimeFlags.set('instantAlerts', v);
    log.info('instant alerts override', { state: v });
    res.json({ ok: true, instantAlerts: flags.instantAlerts(), override: v });
  });

  r.post('/price-check', async (_req, res) => {
    if (rateLimit.limited('admin-price', 'all', 2, 10 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: 'price check ran recently' });
    }
    try {
      const out = await priceCheck();
      res.json({ ok: true, result: out });
    } catch (err) {
      log.error('price check', err);
      res.status(500).json({ ok: false, error: 'price_check_failed' });
    }
  });

  r.get('/logs', (req, res) => {
    const LOGS_MAX = 500;
    const n = Math.min(LOGS_MAX, Math.max(1, Math.floor(Number(req.query.n)) || 200));
    res.json({ ok: true, lines: logger.recent(n) });
  });

  return r;
}

module.exports = { router, tokenOk, counts, growth };
