'use strict';

const crypto = require('crypto');

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

jest.mock('stripe', () => {
  const sessionCreate = jest.fn();
  const customerCreate = jest.fn();
  const constructEvent = jest.fn();
  const Stripe = jest.fn(() => ({
    webhooks: { constructEvent },
    checkout: { sessions: { create: sessionCreate } },
    customers: { create: customerCreate, retrieve: jest.fn() },
    subscriptions: { retrieve: jest.fn() },
  }));
  Stripe.sessionCreate = sessionCreate;
  Stripe.customerCreate = customerCreate;
  Stripe.constructEvent = constructEvent;
  return Stripe;
});

const axios = require('axios');
const Stripe = require('stripe');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const mp = require('../src/services/payments/mp');
const stripePay = require('../src/services/payments/stripe');
const stars = require('../src/services/payments/stars');
const { start } = require('../src/app');
const bot = require('../src/bot');

const LIVE_STRIPE = 'sk_' + 'live_fixture';
const LIVE_MP = 'APP_' + 'USR-fixture';

function signMp(id, requestId, ts, secret) {
  const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

function liveStripeEnv() {
  process.env.PAYMENTS_MODE = 'live';
  process.env.STRIPE_SECRET_KEY = LIVE_STRIPE;
  process.env.STRIPE_PRICE_EUR = 'price_eur';
  process.env.STRIPE_PRICE_USD = 'price_usd';
  process.env.STRIPE_WEBHOOK_SECRET_LIVE = 'whsec-live';
}

beforeEach(() => {
  cleanEnv();
  reset();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.put.mockReset();
  Stripe.sessionCreate.mockReset();
  Stripe.customerCreate.mockReset();
  Stripe.constructEvent.mockReset();
  process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret';
  process.env.NODE_ENV = 'test';
});

afterEach(() => {
  cleanEnv();
  process.env.NODE_ENV = 'test';
});

test('default test arranca; live con claves del mismo modo arranca', () => {
  delete process.env.PAYMENTS_MODE;
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  expect(() => start()).not.toThrow();

  liveStripeEnv();
  process.env.MP_ACCESS_TOKEN = LIVE_MP;
  expect(() => start()).not.toThrow();
});

test('mezcla de modo y clave no arranca', () => {
  process.env.PAYMENTS_MODE = 'live';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  expect(() => start()).toThrow(/PAYMENTS_MODE=live/);

  cleanEnv();
  process.env.PAYMENTS_MODE = 'live';
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  expect(() => start()).toThrow(/PAYMENTS_MODE=live/);

  cleanEnv();
  process.env.PAYMENTS_MODE = 'test';
  process.env.STRIPE_SECRET_KEY = LIVE_STRIPE;
  expect(() => start()).toThrow(/test/);

  cleanEnv();
  delete process.env.PAYMENTS_MODE;
  process.env.MP_ACCESS_TOKEN = LIVE_MP;
  expect(() => start()).toThrow(/test/);

  cleanEnv();
  process.env.PAYMENTS_MODE = 'sandbox';
  expect(() => start()).toThrow(/PAYMENTS_MODE/);
});

test('live sin precio o sin secreto de webhook propio no arranca', () => {
  liveStripeEnv();
  delete process.env.STRIPE_PRICE_USD;
  expect(() => start()).toThrow(/STRIPE_PRICE_USD/);

  process.env.STRIPE_PRICE_USD = 'price_usd';
  delete process.env.STRIPE_WEBHOOK_SECRET_LIVE;
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  expect(() => start()).toThrow(/STRIPE_WEBHOOK_SECRET_LIVE/);
});

test('en producción falta DEVICE_COOKIE_SECRET y no arranca', () => {
  process.env.NODE_ENV = 'production';
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/db';
  process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret';
  delete process.env.DEVICE_COOKIE_SECRET;
  expect(() => start()).toThrow(/DEVICE_COOKIE_SECRET/);
});

test('Stripe live usa el precio del env, IVA incluido en EUR y el secreto live', async () => {
  liveStripeEnv();
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  Stripe.customerCreate.mockResolvedValue({ id: 'cus_1' });
  Stripe.sessionCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test/cs' });

  await stripePay.createCheckout({
    externalReference: 'ref',
    currency: 'EUR',
    unitAmount: 450,
    customerEmail: 'payer@ejemplo.com',
    successUrl: 'http://local.test/ok',
    cancelUrl: 'http://local.test/no',
  });
  const eurSession = Stripe.sessionCreate.mock.calls[0][0];
  expect(eurSession.line_items[0]).toEqual({ quantity: 1, price: 'price_eur' });
  expect(eurSession.automatic_tax).toEqual({ enabled: true });
  expect(eurSession.customer_update).toEqual({ address: 'auto' });
  expect(eurSession.billing_address_collection).toBe('required');

  await stripePay.createCheckout({
    externalReference: 'ref-usd',
    currency: 'USD',
    unitAmount: 500,
    customerEmail: 'payer@ejemplo.com',
    successUrl: 'http://local.test/ok',
    cancelUrl: 'http://local.test/no',
  });
  const usdSession = Stripe.sessionCreate.mock.calls[1][0];
  expect(usdSession.line_items[0]).toEqual({ quantity: 1, price: 'price_usd' });
  expect(usdSession.automatic_tax).toEqual({ enabled: false });
  expect(usdSession.customer_update).toBeUndefined();
  expect(usdSession.billing_address_collection).toBeUndefined();

  delete process.env.STRIPE_PRICE_EUR;
  await expect(stripePay.createCheckout({
    externalReference: 'ref',
    currency: 'EUR',
    unitAmount: 450,
    customerEmail: 'payer@ejemplo.com',
    successUrl: 'http://local.test/ok',
    cancelUrl: 'http://local.test/no',
  })).rejects.toThrow(/STRIPE_PRICE_EUR/);

  process.env.STRIPE_PRICE_EUR = 'price_eur';
  Stripe.constructEvent.mockImplementation((body, _sig, secret) => {
    if (secret !== 'whsec-live') throw new Error('secret');
    return JSON.parse(body.toString());
  });
  const event = {
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'in_1', currency: 'eur', amount_paid: 450, metadata: { external_reference: 'ref' } } },
  };
  await col('Checkout').create({
    externalReference: 'ref',
    telegramUserId: '77',
    provider: 'stripe',
    currency: 'EUR',
  });
  const ok = await stripePay.handleWebhook({
    body: Buffer.from(JSON.stringify(event)),
    headers: { 'stripe-signature': 't' },
  });
  expect(ok.status).toBe(200);
  expect(Stripe.constructEvent.mock.calls[0][2]).toBe('whsec-live');
});

test('MP cobra el mes sin external_reference resolviendo la suscripción', async () => {
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  const ts = '17000000';
  await col('Checkout').create({
    externalReference: 'ref-mp-sub',
    telegramUserId: '77',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockImplementation((url) => {
    const target = String(url);
    if (target.includes('/v1/payments/pay-sub')) {
      return Promise.resolve({
        data: {
          id: 'pay-sub',
          status: 'approved',
          transaction_amount: 7700,
          currency_id: 'ARS',
          payer: { email: 'payer@ejemplo.com' },
          point_of_interaction: { transaction_data: { subscription_id: 'pre-sub' } },
        },
      });
    }
    if (target.includes('/v1/payments/pay-meta')) {
      return Promise.resolve({
        data: {
          id: 'pay-meta',
          status: 'approved',
          transaction_amount: 7700,
          currency_id: 'ARS',
          metadata: { preapproval_id: 'pre-sub' },
        },
      });
    }
    if (target.includes('/preapproval/pre-sub')) {
      return Promise.resolve({
        data: { id: 'pre-sub', status: 'authorized', external_reference: 'ref-mp-sub' },
      });
    }
    if (target.includes('/v1/payments/pay-none')) {
      return Promise.resolve({
        data: { id: 'pay-none', status: 'approved', transaction_amount: 100 },
      });
    }
    return Promise.reject(new Error(target));
  });

  const payment = await mp.handleWebhook({
    query: { 'data.id': 'pay-sub' },
    headers: { 'x-signature': signMp('pay-sub', 'req-sub', ts, 'mp-test-secret'), 'x-request-id': 'req-sub' },
    body: { type: 'payment' },
  });
  expect(payment.activated).toBe(true);
  expect(axios.get.mock.calls.map((call) => call[0]).join(' ')).toContain('/preapproval/pre-sub');
  expect((await col('Entitlement').findOne({ telegramUserId: '77' })).plan).toBe('pro');

  const again = await mp.handleWebhook({
    query: { 'data.id': 'pay-meta' },
    headers: { 'x-signature': signMp('pay-meta', 'req-meta', ts, 'mp-test-secret'), 'x-request-id': 'req-meta' },
    body: { type: 'payment' },
  });
  expect(again.activated).toBe(true);
  expect(again.duplicate).toBe(false);

  const orphan = await mp.handleWebhook({
    query: { 'data.id': 'pay-none' },
    headers: { 'x-signature': signMp('pay-none', 'req-none', ts, 'mp-test-secret'), 'x-request-id': 'req-none' },
    body: { type: 'payment' },
  });
  expect(orphan.activated).toBe(false);
});

test('cada cobro real avisa monto, moneda y proveedor, sin datos personales', async () => {
  const sendMessage = jest.fn().mockResolvedValue({});
  const spy = jest.spyOn(bot, 'getBot').mockReturnValue({ sendMessage });
  const logs = [];
  const logSpy = jest.spyOn(console, 'log').mockImplementation((line) => logs.push(String(line)));
  process.env.OWNER_TELEGRAM_IDS = '42';

  liveStripeEnv();
  process.env.MP_ACCESS_TOKEN = LIVE_MP;
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  Stripe.constructEvent.mockImplementation((body) => JSON.parse(body.toString()));
  await col('Checkout').create({
    externalReference: 'ref-live',
    telegramUserId: '88',
    provider: 'stripe',
    currency: 'EUR',
  });
  const event = {
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'in_live',
        currency: 'eur',
        amount_paid: 450,
        customer_email: 'payer@ejemplo.com',
        metadata: { external_reference: 'ref-live' },
      },
    },
  };
  await stripePay.handleWebhook({
    body: Buffer.from(JSON.stringify(event)),
    headers: { 'stripe-signature': 't' },
  });
  await stripePay.handleWebhook({
    body: Buffer.from(JSON.stringify(event)),
    headers: { 'stripe-signature': 't' },
  });

  const ts = '17000000';
  await col('Checkout').create({
    externalReference: 'ref-mp-live',
    telegramUserId: '88',
    provider: 'mp',
    currency: 'ARS',
  });
  axios.get.mockImplementation((url) => {
    if (String(url).includes('/v1/payments/')) {
      return Promise.resolve({
        data: {
          id: 'pay-live',
          status: 'approved',
          transaction_amount: 7700,
          currency_id: 'ARS',
          payer: { email: 'payer@ejemplo.com' },
          preapproval_id: 'pre-live',
        },
      });
    }
    return Promise.resolve({
      data: { id: 'pre-live', external_reference: 'ref-mp-live', status: 'authorized' },
    });
  });
  await mp.handleWebhook({
    query: { 'data.id': 'pay-live' },
    headers: { 'x-signature': signMp('pay-live', 'req-live', ts, 'mp-test-secret'), 'x-request-id': 'req-live' },
    body: { type: 'payment' },
  });

  const payload = await stars.issuePayload('88');
  await stars.onSuccess({
    from: { id: '88' },
    chat: { id: '88' },
    successful_payment: {
      telegram_payment_charge_id: 'charge-live',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: payload,
    },
  });

  const texts = sendMessage.mock.calls.map((call) => call[1]);
  expect(texts).toEqual([
    'Cobro real stripe 4.50 EUR',
    'Cobro real mp 7700 ARS',
    'Cobro real stars 250 XTR',
  ]);
  const blob = `${texts.join('\n')}\n${logs.filter((line) => line.includes('cobro real')).join('\n')}`;
  expect(blob).not.toContain('payer@ejemplo.com');
  expect(blob).not.toContain('88');
  expect(sendMessage.mock.calls.every((call) => call[0] === '42')).toBe(true);

  spy.mockRestore();
  logSpy.mockRestore();
  sendMessage.mockClear();
  const quiet = jest.spyOn(bot, 'getBot');
  process.env.PAYMENTS_MODE = 'test';
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  const testEvent = {
    type: 'invoice.paid',
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'in_test', currency: 'eur', amount_paid: 450, metadata: { external_reference: 'ref-live' } } },
  };
  await stripePay.handleWebhook({
    body: Buffer.from(JSON.stringify(testEvent)),
    headers: { 'stripe-signature': 't' },
  });
  expect(quiet).not.toHaveBeenCalled();
  quiet.mockRestore();

  const starsSend = jest.fn().mockResolvedValue({});
  const starsSpy = jest.spyOn(bot, 'getBot').mockReturnValue({ sendMessage: starsSend });
  const starPayload = await stars.issuePayload('88');
  await stars.onSuccess({
    from: { id: '88' },
    chat: { id: '88' },
    successful_payment: {
      telegram_payment_charge_id: 'charge-test-stars',
      currency: 'XTR',
      total_amount: 250,
      invoice_payload: starPayload,
    },
  });
  expect(starsSend.mock.calls.map((call) => call[1])).toEqual(['Cobro real stars 250 XTR']);
  expect(starsSend.mock.calls[0][1]).not.toContain('88');
  starsSpy.mockRestore();
});

test('MP live abre init_point y actualiza el monto', async () => {
  process.env.PAYMENTS_MODE = 'live';
  process.env.MP_ACCESS_TOKEN = LIVE_MP;
  axios.post.mockResolvedValue({
    data: {
      init_point: 'https://www.mercadopago.test/pre/live',
      sandbox_init_point: 'https://sandbox.mercadopago.test/pre/live',
    },
  });
  const created = await mp.createPreapproval({
    amount: 7700,
    externalReference: 'ref',
    payerEmail: 'payer@ejemplo.com',
    backUrl: 'http://local.test/ok',
  });
  expect(mp.checkoutUrl(created)).toBe('https://www.mercadopago.test/pre/live');
  axios.put.mockResolvedValue({ data: { id: 'pre-1' } });
  const updated = await mp.updatePreapprovalAmount('pre-1', 8000);
  expect(updated.skipped).toBeUndefined();
  expect(axios.put).toHaveBeenCalled();
});
