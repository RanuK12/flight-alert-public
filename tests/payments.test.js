'use strict';

const crypto = require('crypto');

jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
}));

jest.mock('stripe', () => {
  const constructEvent = jest.fn();
  const create = jest.fn();
  const Stripe = jest.fn(() => ({
    webhooks: { constructEvent },
    checkout: { sessions: { create } },
  }));
  Stripe.constructEvent = constructEvent;
  return Stripe;
});

const axios = require('axios');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const mp = require('../src/services/payments/mp');
const stripePay = require('../src/services/payments/stripe');
const stars = require('../src/services/payments/stars');
const entitlements = require('../src/services/entitlements');
const fx = require('../src/services/fx');
const country = require('../src/services/country');

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  axios.get.mockReset();
});

afterEach(() => cleanEnv());

test('P9. Stars activa Pro 30 días y el mismo cargo no duplica', async () => {
  clock.setNow(new Date('2026-10-10T15:00:00.000Z'));
  const payload = await stars.issuePayload('101');
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
  const doc = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(doc.plan).toBe('pro');
  expect(new Date(doc.proUntil).getTime() - clock.now().getTime()).toBe(30 * DAY);
});

test('P10. MP: firma inválida 401 y no activa; firma válida y authorized activa', async () => {
  process.env.MP_WEBHOOK_SECRET = 'mp-test-secret';
  process.env.MP_ACCESS_TOKEN = 'TEST-mp-token';
  await col('Checkout').create({
    externalReference: 'ref-opaco',
    telegramUserId: '101',
    provider: 'mp',
  });
  const bad = await mp.handleWebhook({
    query: { 'data.id': 'pre-1' },
    headers: { 'x-signature': 'ts=1,v1=00', 'x-request-id': 'req-1' },
    body: {},
  });
  expect(bad.status).toBe(401);
  expect(axios.get).not.toHaveBeenCalled();
  expect(await col('Entitlement').findOne({ telegramUserId: '101' })).toBeNull();

  const ts = '17000000';
  const manifest = `id:pre-1;request-id:req-1;ts:${ts};`;
  const v1 = crypto.createHmac('sha256', 'mp-test-secret').update(manifest).digest('hex');
  axios.get.mockResolvedValue({
    data: { id: 'pre-1', status: 'authorized', external_reference: 'ref-opaco' },
  });
  const ok = await mp.handleWebhook({
    query: { 'data.id': 'pre-1' },
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' },
    body: {},
  });
  expect(ok.status).toBe(200);
  const doc = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(doc.plan).toBe('pro');
  const until = doc.proUntil;
  const again = await mp.handleWebhook({
    query: { 'data.id': 'pre-1' },
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': 'req-1' },
    body: {},
  });
  expect(again.status).toBe(200);
  const after = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(after.proUntil).toBe(until);
});

test('P11. Stripe rechaza firma o timestamp viejo; el fallo abre gracia y el día 4 pasa a free', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  const Stripe = require('stripe');
  const start = new Date('2026-10-10T15:00:00.000Z');
  clock.setNow(start);
  await col('Checkout').create({
    externalReference: 'ref-stripe',
    telegramUserId: '101',
    provider: 'stripe',
  });
  await col('Route').create({
    telegramUserId: '101',
    telegramChatId: '101',
    origin: 'EZE',
    destination: 'MAD',
    tripType: 'oneway',
    outboundDate: '2026-12-01',
    paused: false,
  });

  Stripe.constructEvent.mockImplementationOnce(() => { throw new Error('bad sig'); });
  const invalid = await stripePay.handleWebhook({ body: Buffer.from('{}'), headers: { 'stripe-signature': 't' } });
  expect(invalid.status).toBe(400);

  Stripe.constructEvent.mockImplementationOnce(() => ({
    type: 'invoice.payment_failed',
    created: Math.floor(start.getTime() / 1000) - 301,
    data: { object: { id: 'in_old', client_reference_id: 'ref-stripe' } },
  }));
  const old = await stripePay.handleWebhook({ body: Buffer.from('{}'), headers: { 'stripe-signature': 't' } });
  expect(old.status).toBe(400);

  Stripe.constructEvent.mockImplementationOnce(() => ({
    type: 'invoice.payment_failed',
    created: Math.floor(start.getTime() / 1000),
    data: { object: { id: 'in_1', client_reference_id: 'ref-stripe' } },
  }));
  const failed = await stripePay.handleWebhook({ body: Buffer.from('{}'), headers: { 'stripe-signature': 't' } });
  expect(failed.grace).toBe(true);
  const during = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(during.plan).toBe('pro');
  expect(during.graceUntil).toBeTruthy();

  clock.setNow(new Date(start.getTime() + 4 * DAY));
  await entitlements.expire(null);
  const after = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(after.plan).toBe('free');
  const route = await col('Route').findOne({ telegramUserId: '101' });
  expect(route.paused).toBe(true);
});

test('P12. FX: BNA 1540 → 7700, fallback 1600 → 8000, las dos caídas dejan el último', async () => {
  fx.setFetchers({
    bna: async () => 1540,
    dolarapi: async () => { throw new Error('no'); },
  });
  expect((await fx.refresh()).ars).toBe(7700);
  fx.setFetchers({
    bna: async () => { throw new Error('caido'); },
    dolarapi: async () => 1600,
  });
  expect((await fx.refresh()).ars).toBe(8000);
  fx.setFetchers({
    bna: async () => { throw new Error('caido'); },
    dolarapi: async () => { throw new Error('caido'); },
  });
  const stale = await fx.refresh();
  expect(stale.stale).toBe(true);
  expect(stale.ars).toBe(8000);
});

test('P13. AR con IP de España ofrece Stripe; AR con IP de Argentina ofrece MP', () => {
  expect(country.rail({ choice: 'AR', ipCountry: 'ES' })).toBe('stripe');
  expect(country.rail({ choice: 'AR', ipCountry: 'AR' })).toBe('mp');
  expect(country.preselect('es-AR')).toBe('AR');
  expect(country.rail({ choice: country.preselect('es-AR'), ipCountry: 'ES' })).toBe('stripe');
});
