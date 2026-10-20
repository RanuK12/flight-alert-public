'use strict';

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

jest.mock('geoip-lite', () => ({
  lookup: jest.fn(() => null),
}));

jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => ({
  _text: [],
  _on: {},
  onText(re, cb) { this._text.push({ re, cb }); },
  on(ev, cb) { this._on[ev] = cb; },
  sendMessage: jest.fn().mockResolvedValue({}),
  answerCallbackQuery: jest.fn().mockResolvedValue(true),
  answerPreCheckoutQuery: jest.fn().mockResolvedValue(true),
  setMyCommands: jest.fn().mockResolvedValue(true),
  createInvoiceLink: jest.fn().mockResolvedValue('https://t.me/invoice/test'),
})));

jest.mock('stripe', () => {
  const constructEvent = jest.fn();
  const create = jest.fn();
  const customerCreate = jest.fn();
  const subRetrieve = jest.fn();
  const custRetrieve = jest.fn();
  const Stripe = jest.fn(() => ({
    webhooks: { constructEvent },
    checkout: { sessions: { create } },
    customers: { create: customerCreate, retrieve: custRetrieve },
    subscriptions: { retrieve: subRetrieve },
  }));
  Stripe.constructEvent = constructEvent;
  Stripe.sessionCreate = create;
  Stripe.customerCreate = customerCreate;
  Stripe.subRetrieve = subRetrieve;
  Stripe.custRetrieve = custRetrieve;
  return Stripe;
});

const axios = require('axios');
const geoip = require('geoip-lite');
const Stripe = require('stripe');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col, health, open, setConnector, resetConnector, ATTEMPTS } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const country = require('../src/services/country');
const fx = require('../src/services/fx');
const stars = require('../src/services/payments/stars');
const mp = require('../src/services/payments/mp');
const stripePay = require('../src/services/payments/stripe');
const link = require('../src/services/payments/link');
const { createApp, start } = require('../src/app');

const DAY = 24 * 60 * 60 * 1000;

function get(app, urlPath, headers) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http.get({ port, path: urlPath, headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
      }).on('error', reject);
    });
  });
}

function post(app, urlPath, form, headers) {
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
          ...headers,
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

function signMp(id, requestId, ts, secret) {
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  rateLimit.reset();
  country.resetLookup();
  fx.resetFetchers();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.put.mockReset();
  process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret';
  resetConnector();
  Stripe.sessionCreate.mockReset();
  Stripe.customerCreate.mockReset();
  Stripe.subRetrieve.mockReset();
  Stripe.custRetrieve.mockReset();
  Stripe.constructEvent.mockReset();
});

afterEach(() => {
  cleanEnv();
  process.env.NODE_ENV = 'test';
});

test('checkout redirige al link real, valida el email y exige monto ARS', async () => {
  const app = createApp();
  process.env.FEATURE_PAYMENTS_STRIPE = 'on';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.PUBLIC_BASE_URL = 'http://local.test';
  Stripe.customerCreate.mockResolvedValue({ id: 'cus_1' });
  Stripe.sessionCreate.mockResolvedValue({ id: 'cs_test_abc', url: 'https://checkout.stripe.test/cs_test_abc' });

  const bad = await post(app, '/pro/checkout', { pais: 'ES', email: 'no-es-email' });
  expect(bad.status).toBe(400);
  expect(bad.body).toContain('email');
  expect(Stripe.sessionCreate).not.toHaveBeenCalled();

  const eur = await post(app, '/pro/checkout', { pais: 'ES', email: 'ana@ejemplo.com' });
  expect(eur.status).toBe(303);
  expect(eur.location).toBe('https://checkout.stripe.test/cs_test_abc');
  expect(eur.location).not.toContain('/pro/listo');
  expect(Stripe.customerCreate).toHaveBeenCalledWith(expect.objectContaining({
    email: 'ana@ejemplo.com',
    metadata: { external_reference: expect.any(String) },
  }));
  const sessionArgs = Stripe.sessionCreate.mock.calls[0][0];
  expect(sessionArgs.subscription_data.metadata.external_reference).toBe(sessionArgs.client_reference_id);
  expect(sessionArgs.line_items[0].price_data).toMatchObject({
    currency: 'eur',
    unit_amount: 450,
    tax_behavior: 'inclusive',
  });

  Stripe.sessionCreate.mockClear();
  const usd = await post(app, '/pro/checkout', { pais: 'US', email: 'ana@ejemplo.com' });
  expect(usd.status).toBe(303);
  expect(Stripe.sessionCreate.mock.calls[0][0].line_items[0].price_data).toMatchObject({
    currency: 'usd',
    unit_amount: 500,
  });

  process.env.FEATURE_PAYMENTS_MP = 'on';
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  country.setLookup(async () => 'AR');
  const missing = await post(app, '/pro/checkout', { pais: 'AR', email: 'ana@ejemplo.com' });
  expect(missing.status).toBe(400);
  expect(missing.body).toContain('pesos');
  expect(axios.post).not.toHaveBeenCalled();

  await col('FxRate').create({ publishedArs: 7700, usedRate: 1540, at: '2026-10-10T00:00:00.000Z' });
  axios.post.mockResolvedValue({
    data: {
      sandbox_init_point: 'https://sandbox.mercadopago.test/pre/abc',
      init_point: 'https://www.mercadopago.test/pre/abc',
    },
  });
  const ars = await post(app, '/pro/checkout', { pais: 'AR', email: 'ana@ejemplo.com' });
  expect(ars.status).toBe(303);
  expect(ars.location).toBe('https://sandbox.mercadopago.test/pre/abc');
  expect(ars.location).not.toContain('/pro/listo');
  expect(axios.post.mock.calls[0][1].auto_recurring.transaction_amount).toBe(7700);
});

test('EUR 4,50 para toda la UE, USD 5 para el resto y ARS solo en AR', () => {
  expect(country.EU.size).toBe(27);
  for (const code of country.EU) {
    expect(country.currencyFor(code, 'US')).toEqual({ rail: 'stripe', currency: 'EUR', unitAmount: 450 });
  }
  expect(country.currencyFor('US', 'AR')).toEqual({ rail: 'stripe', currency: 'USD', unitAmount: 500 });
  expect(country.currencyFor('GB', 'FR')).toEqual({ rail: 'stripe', currency: 'USD', unitAmount: 500 });
  expect(country.currencyFor('AR', 'AR')).toEqual({ rail: 'mp', currency: 'ARS', unitAmount: null });
  expect(country.currencyFor('AR', 'ES').currency).toBe('EUR');
  expect(country.currencyFor('AR', '').currency).toBe('USD');
});

test('Stars valida payload, total 250 y XTR, y el cargo no se duplica', async () => {
  const payload = await stars.issuePayload('101');
  const ok = await stars.validatePreCheckout({
    id: 'q1',
    from: { id: '101' },
    currency: 'XTR',
    total_amount: 250,
    invoice_payload: payload,
  });
  expect(ok.ok).toBe(true);
  expect((await stars.validatePreCheckout({
    id: 'q2', from: { id: '101' }, currency: 'XTR', total_amount: 249, invoice_payload: payload,
  })).ok).toBe(false);
  expect((await stars.validatePreCheckout({
    id: 'q3', from: { id: '101' }, currency: 'EUR', total_amount: 250, invoice_payload: payload,
  })).ok).toBe(false);
  expect((await stars.validatePreCheckout({
    id: 'q4', from: { id: '202' }, currency: 'XTR', total_amount: 250, invoice_payload: payload,
  })).ok).toBe(false);
  expect((await stars.validatePreCheckout({
    id: 'q5', from: { id: '101' }, currency: 'XTR', total_amount: 250, invoice_payload: 'firma.falsa',
  })).ok).toBe(false);

  const rejected = await stars.onSuccess({
    from: { id: '101' },
    chat: { id: '101' },
    successful_payment: {
      telegram_payment_charge_id: 'charge-x',
      currency: 'XTR',
      total_amount: 1,
      invoice_payload: payload,
    },
  });
  expect(rejected.ok).toBe(false);
  expect(await col('Entitlement').findOne({ telegramUserId: '101' })).toBeNull();

  const msg = {
    from: { id: '101' },
    chat: { id: '101' },
    successful_payment: {
      telegram_payment_charge_id: 'charge-1',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
    },
  };
  const first = await stars.onSuccess(msg);
  const second = await stars.onSuccess(msg);
  expect(first.duplicate).toBe(false);
  expect(second.duplicate).toBe(true);
  expect(second.proUntil).toBe(first.proUntil);
});

test('invoice.paid renueva por metadata y la baja de la suscripción deja free', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  const startAt = new Date('2026-10-10T15:00:00.000Z');
  clock.setNow(startAt);
  await col('Checkout').create({
    externalReference: 'ref-stripe',
    telegramUserId: '101',
    provider: 'stripe',
    currency: 'EUR',
  });
  await col('Route').create({
    telegramUserId: '101',
    origin: 'EZE',
    destination: 'MAD',
    paused: false,
  });
  Stripe.subRetrieve.mockResolvedValue({ metadata: { external_reference: 'ref-stripe' } });
  Stripe.constructEvent.mockImplementation((body) => JSON.parse(body.toString()));

  const firstEvent = {
    type: 'invoice.paid',
    created: Math.floor(startAt.getTime() / 1000),
    data: { object: { id: 'in_1', object: 'invoice', currency: 'eur', subscription: 'sub_1', customer: 'cus_1' } },
  };
  const first = await stripePay.handleWebhook({ body: Buffer.from(JSON.stringify(firstEvent)), headers: { 'stripe-signature': 't' } });
  expect(first.status).toBe(200);
  expect(Stripe.subRetrieve).toHaveBeenCalledWith('sub_1');
  const opened = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(opened.plan).toBe('pro');
  const firstUntil = opened.proUntil;

  clock.setNow(new Date(startAt.getTime() + (20 * DAY)));
  const secondEvent = {
    type: 'invoice.paid',
    created: Math.floor(clock.now().getTime() / 1000),
    data: { object: { id: 'in_2', object: 'invoice', currency: 'eur', subscription: 'sub_1', customer: 'cus_1' } },
  };
  await stripePay.handleWebhook({ body: Buffer.from(JSON.stringify(secondEvent)), headers: { 'stripe-signature': 't' } });
  const renewed = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(new Date(renewed.proUntil).getTime() - clock.now().getTime()).toBe(30 * DAY);
  expect(new Date(renewed.proUntil).getTime()).toBeGreaterThan(new Date(firstUntil).getTime());

  Stripe.custRetrieve.mockResolvedValue({ metadata: { external_reference: 'ref-stripe' } });
  const deleted = {
    type: 'customer.subscription.deleted',
    created: Math.floor(clock.now().getTime() / 1000),
    data: { object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', metadata: {} } },
  };
  const down = await stripePay.handleWebhook({ body: Buffer.from(JSON.stringify(deleted)), headers: { 'stripe-signature': 't' } });
  expect(down.downgraded).toBe(true);
  expect(Stripe.custRetrieve).toHaveBeenCalledWith('cus_1');
  const after = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(after.plan).toBe('free');
  const route = await col('Route').findOne({ telegramUserId: '101' });
  expect(route.paused).toBe(true);
});

test('MP y Stripe guardan pending_link y /start link_ activa', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  process.env.TELEGRAM_BOT_USERNAME = 'vuelosbot';
  const ts = '17000000';
  await col('Checkout').create({
    externalReference: 'ref-mp',
    telegramUserId: null,
    webUserKey: 'web-mp',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockResolvedValue({
    data: { id: 'pre-1', status: 'authorized', external_reference: 'ref-mp' },
  });
  const mpRes = await mp.handleWebhook({
    query: { 'data.id': 'pre-1', type: 'subscription_preapproval' },
    headers: { 'x-signature': signMp('pre-1', 'req-1', ts, 'mp-test-secret'), 'x-request-id': 'req-1' },
    body: { type: 'subscription_preapproval' },
  });
  expect(mpRes.pendingLink).toBe(true);
  expect((await col('Payment').findOne({ provider: 'mp', ref: 'pre-1' })).status).toBe('pending_link');
  expect(await col('Entitlement').findOne({ telegramUserId: '101' })).toBeNull();
  const linked = await link.createLink('web-mp');
  expect(linked.url).toContain('start=link_');
  expect((await link.consume(linked.code, '101', '101')).ok).toBe(true);
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).plan).toBe('pro');
  expect((await col('Payment').findOne({ provider: 'mp', ref: 'pre-1' })).status).toBe('paid');

  reset();
  await col('Checkout').create({
    externalReference: 'ref-stripe',
    telegramUserId: null,
    webUserKey: 'web-st',
    provider: 'stripe',
    currency: 'EUR',
  });
  Stripe.subRetrieve.mockResolvedValue({ metadata: { external_reference: 'ref-stripe' } });
  Stripe.constructEvent.mockImplementation((body) => JSON.parse(body.toString()));
  const event = {
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'in_9', object: 'invoice', subscription: 'sub_9', customer: 'cus_9' } },
  };
  const stripeRes = await stripePay.handleWebhook({
    body: Buffer.from(JSON.stringify(event)),
    headers: { 'stripe-signature': 't' },
  });
  expect(stripeRes.pendingLink).toBe(true);
  expect(await col('Entitlement').findOne({ telegramUserId: '202' })).toBeNull();
  const code = await link.createLink('web-st');
  expect((await link.consume(code.code, '202', '202')).ok).toBe(true);
  expect((await col('Entitlement').findOne({ telegramUserId: '202' })).plan).toBe('pro');
});

test('sin URI en producción falla y /health refleja la base', async () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  delete process.env.MONGODB_URI;
  expect(() => open()).toThrow(/MONGODB_URI/);
  expect(health()).toEqual({ ok: false, db: 'missing' });
  const app = createApp();
  const res = await get(app, '/health');
  expect(res.status).toBe(503);
  expect(res.body).toContain('missing');
  process.env.NODE_ENV = prev;
  expect(health()).toEqual({ ok: true, db: 'memory' });
});

test('la IP sale del trust proxy y el geo no usa headers del cliente', async () => {
  const app = createApp();
  expect(app.get('trust proxy')).toBe(1);
  geoip.lookup.mockReturnValue({ country: 'ES' });
  const code = await country.ipCountry({
    ip: '203.0.113.8',
    headers: { 'cf-ipcountry': 'AR', 'x-geo-country': 'AR', 'x-forwarded-for': '198.51.100.1' },
  });
  expect(code).toBe('ES');
  expect(geoip.lookup).toHaveBeenCalledWith('203.0.113.8');
  expect(axios.get).not.toHaveBeenCalled();
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'country.js'), 'utf8');
  expect(src.includes('ipwho.is')).toBe(false);
  expect(src.includes('geoip-lite')).toBe(true);

  let last = null;
  for (let i = 1; i <= 21; i += 1) {
    last = await get(app, '/', { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.20` });
  }
  expect(last.status).toBe(429);
});

test('el dólar sale de dolarapi y si cae queda el último, sin HTML', async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'fx.js'), 'utf8');
  expect(src.includes('dolarapi.com/v1/dolares/oficial')).toBe(true);
  expect(src.includes('bna.com')).toBe(false);
  axios.get.mockResolvedValueOnce({ data: { venta: 1540 } });
  expect((await fx.refresh()).ars).toBe(7700);
  expect(axios.get.mock.calls[0][0]).toBe('https://dolarapi.com/v1/dolares/oficial');
  axios.get.mockRejectedValue(new Error('caido'));
  const stale = await fx.refresh();
  expect(stale.stale).toBe(true);
  expect(stale.ars).toBe(7700);
});

test('MP separa el endpoint de payment del de preapproval', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  const ts = '17000000';
  await col('Checkout').create({
    externalReference: 'ref-pay',
    telegramUserId: '101',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockResolvedValue({
    data: { id: 'pay-1', status: 'approved', external_reference: 'ref-pay' },
  });
  const payment = await mp.handleWebhook({
    query: { 'data.id': 'pay-1' },
    headers: { 'x-signature': signMp('pay-1', 'req-p', ts, 'mp-test-secret'), 'x-request-id': 'req-p' },
    body: { type: 'payment' },
  });
  expect(payment.activated).toBe(true);
  expect(payment.payment).toBe(true);
  expect(axios.get.mock.calls[0][0]).toContain('/v1/payments/');
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).plan).toBe('pro');

  axios.get.mockResolvedValue({
    data: { id: 'pre-2', status: 'authorized', external_reference: 'ref-pay' },
  });
  const sub = await mp.handleWebhook({
    query: { 'data.id': 'pre-2', topic: 'subscription_preapproval' },
    headers: { 'x-signature': signMp('pre-2', 'req-s', ts, 'mp-test-secret'), 'x-request-id': 'req-s' },
    body: {},
  });
  expect(sub.activated).toBe(true);
  expect(axios.get.mock.calls[1][0]).toContain('/preapproval/');
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).plan).toBe('pro');
});

test('rechaza claves de Stripe y Mercado Pago que no son de test', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_' + 'live_no';
  await expect(stripePay.createCheckout({
    externalReference: 'ref',
    currency: 'EUR',
    unitAmount: 450,
    customerEmail: 'ana@ejemplo.com',
    successUrl: 'http://local.test/pro/listo',
    cancelUrl: 'http://local.test/pro',
  })).rejects.toThrow(/test/);

  process.env.MP_ACCESS_TOKEN = 'APP_' + 'USR-no';
  await expect(mp.createPreapproval({
    amount: 7700,
    externalReference: 'ref',
    payerEmail: 'ana@ejemplo.com',
    backUrl: 'http://local.test/pro/listo',
  })).rejects.toThrow(/test/);
  expect(axios.post).not.toHaveBeenCalled();
});

test('el pre_checkout del bot exige el payload guardado', async () => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  const { resetBot } = require('../src/bot');
  resetBot();
  start();
  const TelegramBot = require('node-telegram-bot-api');
  const bot = TelegramBot.mock.results.at(-1).value;
  const payload = await stars.issuePayload('101');
  await bot._on.pre_checkout_query({
    id: 'q1',
    from: { id: '101' },
    currency: 'XTR',
    total_amount: 250,
    invoice_payload: payload,
  });
  expect(bot.answerPreCheckoutQuery).toHaveBeenCalledWith('q1', true);
  await bot._on.pre_checkout_query({
    id: 'q2',
    from: { id: '202' },
    currency: 'XTR',
    total_amount: 250,
    invoice_payload: payload,
  });
  expect(bot.answerPreCheckoutQuery).toHaveBeenCalledWith('q2', false, { error_message: 'No pude validar este pago.' });
  resetBot();
});

test('A. una renovación Stars con charge nuevo extiende 30 días y el mismo cargo no', async () => {
  const DAY = 24 * 60 * 60 * 1000;
  clock.setNow(new Date('2026-10-10T15:00:00.000Z'));
  const payload = await stars.issuePayload('101');
  const base = {
    from: { id: '101' },
    chat: { id: '101' },
  };
  const first = await stars.onSuccess({
    ...base,
    successful_payment: {
      telegram_payment_charge_id: 'charge-1',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
    },
  });
  expect(first.duplicate).toBe(false);
  const reused = await stars.onSuccess({
    ...base,
    successful_payment: {
      telegram_payment_charge_id: 'charge-4',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
      is_recurring: false,
    },
  });
  expect(reused.ok).toBe(false);
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).proUntil).toBe(first.proUntil);

  clock.setNow(new Date('2026-10-30T15:00:00.000Z'));
  const renew = await stars.onSuccess({
    ...base,
    successful_payment: {
      telegram_payment_charge_id: 'charge-2',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
      is_recurring: true,
    },
  });
  expect(renew.duplicate).toBe(false);
  expect(new Date(renew.proUntil).getTime() - clock.now().getTime()).toBe(30 * DAY);
  expect(new Date(renew.proUntil).getTime()).toBeGreaterThan(new Date(first.proUntil).getTime());
  const same = await stars.onSuccess({
    ...base,
    successful_payment: {
      telegram_payment_charge_id: 'charge-2',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
      is_recurring: true,
    },
  });
  expect(same.duplicate).toBe(true);
  expect(same.proUntil).toBe(renew.proUntil);
  const other = await stars.onSuccess({
    from: { id: '202' },
    chat: { id: '202' },
    successful_payment: {
      telegram_payment_charge_id: 'charge-3',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
      is_recurring: true,
    },
  });
  expect(other.ok).toBe(false);
});

test('B. un payment aprobado vinculado extiende Pro; sin vínculo queda pending_link', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  const ts = '17000000';
  clock.setNow(new Date('2026-10-10T15:00:00.000Z'));
  await col('Checkout').create({
    externalReference: 'ref-linked',
    telegramUserId: '101',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockResolvedValue({
    data: { id: 'pay-1', status: 'approved', external_reference: 'ref-linked' },
  });
  const headers = {
    'x-signature': signMp('pay-1', 'req-b', ts, 'mp-test-secret'),
    'x-request-id': 'req-b',
  };
  const first = await mp.handleWebhook({
    query: { 'data.id': 'pay-1' },
    headers,
    body: { type: 'payment' },
  });
  expect(first.activated).toBe(true);
  const until = (await col('Entitlement').findOne({ telegramUserId: '101' })).proUntil;
  clock.setNow(new Date('2026-11-01T15:00:00.000Z'));
  axios.get.mockResolvedValue({
    data: { id: 'pay-2', status: 'approved', external_reference: 'ref-linked' },
  });
  const renew = await mp.handleWebhook({
    query: { 'data.id': 'pay-2' },
    headers: {
      'x-signature': signMp('pay-2', 'req-b2', ts, 'mp-test-secret'),
      'x-request-id': 'req-b2',
    },
    body: { type: 'payment' },
  });
  expect(renew.activated).toBe(true);
  const extended = (await col('Entitlement').findOne({ telegramUserId: '101' })).proUntil;
  expect(new Date(extended).getTime()).toBeGreaterThan(new Date(until).getTime());
  const dup = await mp.handleWebhook({
    query: { 'data.id': 'pay-2' },
    headers: {
      'x-signature': signMp('pay-2', 'req-b2', ts, 'mp-test-secret'),
      'x-request-id': 'req-b2',
    },
    body: { type: 'payment' },
  });
  expect(dup.duplicate).toBe(true);
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).proUntil).toBe(extended);

  await col('Checkout').create({
    externalReference: 'ref-open',
    telegramUserId: null,
    webUserKey: 'web-open',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockResolvedValue({
    data: { id: 'pay-3', status: 'approved', external_reference: 'ref-open' },
  });
  const pending = await mp.handleWebhook({
    query: { 'data.id': 'pay-3' },
    headers: {
      'x-signature': signMp('pay-3', 'req-b3', ts, 'mp-test-secret'),
      'x-request-id': 'req-b3',
    },
    body: { type: 'payment' },
  });
  expect(pending.pendingLink).toBe(true);
  expect(pending.activated).toBe(false);
  expect((await col('Payment').findOne({ provider: 'mp', ref: 'pay-3' })).status).toBe('pending_link');
  expect(await col('Entitlement').findOne({ telegramUserId: '202' })).toBeNull();
});

test('el link se marca usado una sola vez', async () => {
  const created = await link.createLink('web-atom');
  await col('Checkout').create({
    externalReference: 'ref-atom',
    telegramUserId: null,
    webUserKey: 'web-atom',
    provider: 'mp',
    currency: 'ARS',
  });
  await col('Payment').create({
    provider: 'mp',
    ref: 'pay-atom',
    externalReference: 'ref-atom',
    telegramUserId: null,
    status: 'pending_link',
  });
  const [first, second] = await Promise.all([
    link.consume(created.code, '101', '101'),
    link.consume(created.code, '202', '202'),
  ]);
  const oks = [first, second].filter((row) => row.ok);
  expect(oks).toHaveLength(1);
  expect([first, second].some((row) => row.reason === 'usado')).toBe(true);
  expect((await col('Entitlement').findOne({ telegramUserId: '101' })).plan).toBe('pro');
  expect(await col('Entitlement').findOne({ telegramUserId: '202' })).toBeNull();
  const row = await col('LinkCode').findOne({ webUserKey: 'web-atom' });
  expect(row.used).toBe(true);
});

test('en producción, si Mongo no conecta tras reintentos, el proceso sale', async () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/db';
  process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret';
  let calls = 0;
  setConnector(async () => {
    calls += 1;
    throw new Error('down');
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  const app = start();
  await app.get('booting');
  expect(calls).toBe(ATTEMPTS);
  expect(exitSpy).toHaveBeenCalledWith(1);
  exitSpy.mockRestore();
  resetConnector();
});

test('en producción falta STARS_PAYLOAD_SECRET y no arranca', () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/db';
  delete process.env.STARS_PAYLOAD_SECRET;
  expect(() => start()).toThrow(/STARS_PAYLOAD_SECRET/);
});
