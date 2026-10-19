'use strict';

const express = require('express');
const flags = require('./config/flags');
const { summary } = require('./config');
const logger = require('./utils/logger').child('app');
const rateLimit = require('./services/rateLimit');
const pages = require('./web/pages');
const { deviceHash } = require('./web/device');
const { rail, ipCountry } = require('./services/country');
const fx = require('./services/fx');
const mp = require('./services/payments/mp');
const stripePay = require('./services/payments/stripe');
const link = require('./services/payments/link');
const { runDailyDigest } = require('./services/dailyReport');
const { expire } = require('./services/entitlements');
const { startBot, getBot } = require('./bot');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

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
    res.status(200).json({ ok: true });
  });

  app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local';
    if (rateLimit.limited('ip', String(ip).split(',')[0], 20, 60 * 1000)) {
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

  app.get('/pro', (req, res) => {
    if (flags.kill()) return res.status(503).type('html').send(pages.maintenance());
    deviceHash(req, res);
    res.type('html').send(pages.pro(req));
  });

  app.post('/pro/checkout', async (req, res) => {
    if (flags.kill()) return res.status(503).send(pages.maintenance());
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local').split(',')[0];
    if (rateLimit.limited('checkout', ip, 5, 60 * 60 * 1000)) {
      return res.status(429).type('text/plain').send('Esperá un toque');
    }
    const choice = req.body && req.body.pais;
    const method = rail({ choice, ipCountry: ipCountry(req) });
    const hash = deviceHash(req, res);
    const quote = await fx.latest();
    const amount = quote ? quote.publishedArs : null;
    try {
      if (method === 'mp') {
        if (!flags.mp()) return res.status(403).type('text/plain').send('Mercado Pago no está prendido.');
        const externalReference = await link.newReference('mp', {
          webUserKey: hash,
          amount,
          currency: 'ARS',
        });
        const base = process.env.PUBLIC_BASE_URL || '';
        await mp.createPreapproval({
          amount,
          externalReference,
          payerEmail: req.body.email,
          backUrl: `${base}/pro/listo`,
        });
        const created = await link.createLink(hash);
        return res.redirect(303, `/pro/listo?ok=1`);
      }
      if (!flags.stripe()) return res.status(403).type('text/plain').send('La tarjeta no está prendida.');
      const currency = String(choice || '').toUpperCase() === 'ES' ? 'EUR' : 'USD';
      const priceId = currency === 'EUR' ? process.env.STRIPE_PRICE_EUR : process.env.STRIPE_PRICE_USD;
      const externalReference = await link.newReference('stripe', {
        webUserKey: hash,
        currency,
      });
      const base = process.env.PUBLIC_BASE_URL || '';
      await stripePay.createCheckout({
        priceId,
        externalReference,
        successUrl: `${base}/pro/listo`,
        cancelUrl: `${base}/pro`,
      });
      await link.createLink(hash);
      return res.redirect(303, '/pro/listo?ok=1');
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
  const app = createApp();
  if (process.env.TELEGRAM_BOT_TOKEN) startBot();
  schedule();
  logger.info('servicio público', summary());
  return app;
}

if (require.main === module) {
  const app = start();
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => logger.info('escuchando', { port }));
}

module.exports = { createApp, start, schedule };
