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

async function counts() {
  const now = clock.now().getTime();
  const ents = await col('Entitlement').find({}).lean();
  let pro = 0;
  let trial = 0;
  for (const e of ents) {
    const proLive = e.plan === 'pro' && ((e.proUntil && new Date(e.proUntil).getTime() > now)
      || (e.graceUntil && new Date(e.graceUntil).getTime() > now));
    if (proLive || e.plan === 'owner') pro += 1;
    else if (e.plan === 'trial' && e.trialEndsAt && new Date(e.trialEndsAt).getTime() > now) trial += 1;
  }
  const users = await col('User').countDocuments({});
  const total = Math.max(users, ents.length);
  const since = art.startOfArtDay(clock.now()).getTime();
  const pays = await col('Payment').find({}).lean();
  const today = { stripe: 0, mp: 0, stars: 0 };
  for (const p of pays) {
    const t = new Date(p.paidAt || p.createdAt || 0).getTime();
    if (t >= since && p.status !== 'refunded') today[p.provider] = (today[p.provider] || 0) + 1;
  }
  return { users: { total, free: total - pro, pro, trial }, paymentsToday: today };
}

function router({ clientIp, priceCheck }) {
  const r = express.Router();
  r.use(auth(clientIp));

  r.get('/status', async (_req, res) => {
    const h = health();
    let data = {};
    try { data = await counts(); } catch (err) { data = { error: 'counts_unavailable' }; }
    res.json({
      ok: h.ok,
      db: h.db,
      commit: (process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 12),
      version: require('../../package.json').version,
      uptimeSec: Math.round(process.uptime()),
      now: clock.now().toISOString(),
      kill: flags.kill(),
      instantAlerts: flags.instantAlerts(),
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
    const n = Number(req.query.n) || 200;
    res.json({ ok: true, lines: logger.recent(n) });
  });

  return r;
}

module.exports = { router, tokenOk, counts };
