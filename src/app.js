'use strict';

const crypto = require('crypto');
const express = require('express');
const flags = require('./config/flags');
const { summary } = require('./config');
const logger = require('./utils/logger').child('app');
const db = require('./database');
const rateLimit = require('./services/rateLimit');
const pages = require('./web/pages');
const { deviceHash, assertSecret: assertDeviceSecret } = require('./web/device');
const { assertConfigured } = require('./services/payments/mode');
const { ipCountry, currencyFor } = require('./services/country');
const fx = require('./services/fx');
const { compress } = require('./web/compress');
const landing = require('./web/landing');
const samplePrice = require('./services/samplePrice');
const mp = require('./services/payments/mp');
const stripePay = require('./services/payments/stripe');
const link = require('./services/payments/link');
const { runDailyDigest } = require('./services/dailyReport');
const { expire } = require('./services/entitlements');
const { startBot, getBot } = require('./bot');
const stars = require('./services/payments/stars');

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'local';
}

function negotiate(header) {
  const items = String(header || '').split(',').map((part) => {
    const [tag, ...params] = part.trim().split(';');
    let q = 1;
    for (const param of params) {
      const match = /q=([0-9.]+)/.exec(param.trim());
      if (match) q = Number(match[1]);
    }
    return { tag: tag.trim().toLowerCase(), q };
  }).filter((item) => item.tag && item.q > 0).sort((a, b) => b.q - a.q);
  for (const item of items) {
    if (item.tag.startsWith('en')) return 'en';
    if (item.tag.startsWith('es')) return 'es';
  }
  return 'es';
}

function securityHeaders(_req, res, next) {
  const nonce = crypto.randomBytes(16).toString('hex');
  res.locals.cspNonce = nonce;
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://tp-em.com`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' https://tp-em.com",
    "connect-src 'self' https://tp-em.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join('; '));
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

function validEmail(value) {
  const email = String(value || '').trim();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(compress);

  app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
      const result = await stripePay.handleWebhook(req);
      res.status(result.status).json({ ok: result.status === 200 });
    } catch (err) {
      logger.error('stripe webhook', err);
      res.status(400).json({ ok: false });
    }
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) => {
    const status = db.health();
    res.status(status.ok ? 200 : 503).json({ ok: status.ok, db: status.db });
  });

  app.get('/favicon.ico', (_req, res) => res.status(204).end());
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nAllow: /\n');
  });

  app.use((req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/assets/')) return next();
    const ip = clientIp(req);
    if (rateLimit.limited('ip', String(ip), 20, 60 * 1000)) {
      res.status(429).type('text/plain').send('Esperá un toque');
      return;
    }
    return next();
  });

  app.get('/assets/:name', (req, res) => {
    const hit = landing.assetByName(req.params.name);
    if (!hit) return res.status(404).type('text/plain').send('No está');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Type', hit.type);
    return res.send(hit.body);
  });

  app.get('/api/sample-price', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, sample: samplePrice.current() });
  });

  async function sendLanding(req, res, lang) {
    if (flags.kill()) {
      return res.status(503).type('html').send(pages.maintenance({ nonce: res.locals.cspNonce }));
    }
    deviceHash(req, res);
    try {
      const geo = await ipCountry(req);
      let quote = null;
      try { quote = await fx.latest(); } catch { quote = null; }
      res.set('Cache-Control', 'no-cache');
      res.set('Vary', 'Accept-Language');
      return res.type('html').send(pages.home({
        lang,
        region: landing.regionFor(geo),
        ars: landing.arsFromQuote(quote),
        sample: samplePrice.current(),
        nonce: res.locals.cspNonce,
        base: process.env.PUBLIC_BASE_URL || '',
      }));
    } catch (err) {
      logger.error('landing', err);
      return res.status(500).type('text/plain').send('No pude abrir la página.');
    }
  }

  app.get('/', (req, res) => sendLanding(req, res, negotiate(req.headers['accept-language'])));
  app.get('/en', (req, res) => sendLanding(req, res, 'en'));
  app.get('/es', (req, res) => sendLanding(req, res, 'es'));

  app.get('/pro', async (req, res) => {
    if (flags.kill()) return res.status(503).type('html').send(pages.maintenance({ nonce: res.locals.cspNonce }));
    deviceHash(req, res);
    const geo = await ipCountry(req);
    const choice = req.query && req.query.pais ? String(req.query.pais) : '';
    res.type('html').send(pages.pro({
      choice,
      ipCountry: geo,
      language: req.headers['accept-language'] || '',
      nonce: res.locals.cspNonce,
    }));
  });

  app.post('/pro/checkout', async (req, res) => {
    if (flags.kill()) return res.status(503).send(pages.maintenance({ nonce: res.locals.cspNonce }));
    const ip = clientIp(req);
    if (rateLimit.limited('checkout', ip, 5, 60 * 60 * 1000)) {
      return res.status(429).type('text/plain').send('Esperá un toque');
    }
    const email = req.body && req.body.email;
    if (!validEmail(email)) {
      return res.status(400).type('text/plain').send('El email no es válido.');
    }
    const choice = req.body && req.body.pais;
    const geo = await ipCountry(req);
    const offer = currencyFor(choice, geo);
    const hash = deviceHash(req, res);
    const base = process.env.PUBLIC_BASE_URL || '';
    try {
      if (offer.rail === 'mp') {
        if (!flags.mp()) return res.status(403).type('text/plain').send('Mercado Pago no está prendido.');
        const quote = await fx.latest();
        const amount = quote ? Number(quote.publishedArs) : NaN;
        if (!Number.isFinite(amount) || amount <= 0) {
          return res.status(400).type('text/plain').send('No tengo una cotización en pesos para cobrar. Probá más tarde.');
        }
        const externalReference = await link.newReference('mp', {
          webUserKey: hash,
          amount,
          currency: 'ARS',
        });
        const created = await mp.createPreapproval({
          amount,
          externalReference,
          payerEmail: String(email).trim(),
          backUrl: `${base}/pro/listo`,
        });
        const url = mp.checkoutUrl(created);
        if (!url) return res.status(502).type('text/plain').send('No pude abrir el pago. Probá de nuevo en un rato.');
        return res.redirect(303, url);
      }
      if (!flags.stripe()) return res.status(403).type('text/plain').send('La tarjeta no está prendida.');
      const externalReference = await link.newReference('stripe', {
        webUserKey: hash,
        currency: offer.currency,
      });
      const session = await stripePay.createCheckout({
        externalReference,
        currency: offer.currency,
        unitAmount: offer.unitAmount,
        customerEmail: String(email).trim(),
        successUrl: `${base}/pro/listo`,
        cancelUrl: `${base}/pro`,
      });
      if (!session || !session.url) {
        return res.status(502).type('text/plain').send('No pude abrir el pago. Probá de nuevo en un rato.');
      }
      return res.redirect(303, session.url);
    } catch (err) {
      logger.error('checkout', err);
      return res.status(502).type('text/plain').send('No pude abrir el pago. Probá de nuevo en un rato.');
    }
  });

  app.get('/pro/listo', async (req, res) => {
    if (flags.kill()) return res.status(503).send(pages.maintenance({ nonce: res.locals.cspNonce }));
    const hash = deviceHash(req, res);
    const created = await link.createLink(hash);
    res.type('html').send(pages.listo(created.url, { nonce: res.locals.cspNonce }));
  });

  app.post('/webhooks/mp', async (req, res) => {
    try {
      const result = await mp.handleWebhook(req);
      res.status(result.status).json({ ok: result.status === 200 });
    } catch (err) {
      logger.error('mp webhook', err);
      res.status(401).json({ ok: false });
    }
  });

  return app;
}

function schedule() {
  if (flags.kill()) return;
  if (!process.env.TELEGRAM_BOT_TOKEN && !flags.any()) return;
  const cron = require('node-cron');
  const tz = 'America/Argentina/Buenos_Aires';
  cron.schedule('0 21 * * *', () => {
    runDailyDigest(getBot()).catch((err) => logger.error('informe', err));
  }, { timezone: tz });
  cron.schedule('0 * * * *', () => {
    expire(getBot()).catch((err) => logger.error('vencimientos', err));
  }, { timezone: tz });
  cron.schedule('0 10 * * *', () => {
    fx.refresh()
      .then(() => fx.adjustSubscriptions((id, amount) => require('./services/payments/mp').updatePreapprovalAmount(id, amount)))
      .catch((err) => logger.error('fx', err));
  }, { timezone: tz });
}

function start() {
  db.open();
  stars.assertSecret();
  assertDeviceSecret();
  assertConfigured();
  const app = createApp();
  const booting = db.connect().catch((err) => {
    logger.error('mongo', err);
    if (process.env.NODE_ENV === 'production') process.exit(1);
  });
  app.set('booting', booting);
  if (process.env.TELEGRAM_BOT_TOKEN) startBot();
  schedule();
  logger.info('servicio público', summary());
  return app;
}

if (require.main === module) {
  try {
    const app = start();
    const port = Number(process.env.PORT || 4000);
    app.listen(port, () => logger.info('escuchando', { port }));
  } catch (err) {
    logger.error('arranque', err);
    process.exit(1);
  }
}

module.exports = { createApp, start, schedule };
