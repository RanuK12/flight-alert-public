'use strict';

const express = require('express');
const flags = require('./config/flags');
const { summary } = require('./config');
const logger = require('./utils/logger').child('app');
const db = require('./database');
const rateLimit = require('./services/rateLimit');
const pages = require('./web/pages');
const { deviceHash } = require('./web/device');
const { ipCountry, currencyFor } = require('./services/country');
const fx = require('./services/fx');
const mp = require('./services/payments/mp');
const stripePay = require('./services/payments/stripe');
const link = require('./services/payments/link');
const { runDailyDigest } = require('./services/dailyReport');
const { expire } = require('./services/entitlements');
const { startBot, getBot } = require('./bot');

function clientIp(req) {
  return req.ip || (req.socket && req.socket.remoteAddress) || 'local';
}

function validEmail(value) {
  const email = String(value || '').trim();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

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

  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const ip = clientIp(req);
    if (rateLimit.limited('ip', String(ip), 20, 60 * 1000)) {
      res.status(429).type('text/plain').send('Esperá un toque');
      return;
    }
    return next();
  });

  app.get('/', (req, res) => {
    if (flags.kill()) return res.status(503).send(pages.maintenance());
    deviceHash(req, res);
    res.type('html').send(pages.home());
  });

  app.get('/pro', async (req, res) => {
    if (flags.kill()) return res.status(503).type('html').send(pages.maintenance());
    deviceHash(req, res);
    const geo = await ipCountry(req);
    const choice = req.query && req.query.pais ? String(req.query.pais) : '';
    res.type('html').send(pages.pro({
      choice,
      ipCountry: geo,
      language: req.headers['accept-language'] || '',
    }));
  });

  app.post('/pro/checkout', async (req, res) => {
    if (flags.kill()) return res.status(503).send(pages.maintenance());
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
    if (flags.kill()) return res.status(503).send(pages.maintenance());
    const hash = deviceHash(req, res);
    const created = await link.createLink(hash);
    res.type('html').send(pages.listo(created.url));
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
  const app = createApp();
  db.connect().catch((err) => logger.error('mongo', err));
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
