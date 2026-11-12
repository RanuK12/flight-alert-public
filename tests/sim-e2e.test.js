'use strict';

const crypto = require('crypto');
const http = require('http');

jest.mock('stripe', () => {
  const constructEvent = jest.fn();
  const create = jest.fn();
  const subRetrieve = jest.fn();
  const custCreate = jest.fn().mockResolvedValue({ id: 'cus_sim' });
  const custRetrieve = jest.fn();
  const Stripe = jest.fn(() => ({
    webhooks: { constructEvent },
    checkout: { sessions: { create } },
    subscriptions: { retrieve: subRetrieve },
    customers: { create: custCreate, retrieve: custRetrieve },
  }));
  Stripe.constructEvent = constructEvent;
  Stripe.create = create;
  Stripe.subRetrieve = subRetrieve;
  Stripe.custCreate = custCreate;
  Stripe.custRetrieve = custRetrieve;
  return Stripe;
});

const Stripe = require('stripe');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const plans = require('../src/config/plans');
const entitlements = require('../src/services/entitlements');
const stripePay = require('../src/services/payments/stripe');
const webSession = require('../src/web/webSession');
const funnel = require('../src/services/funnel');
const instantAlerts = require('../src/services/instantAlerts');
const travelpayouts = require('../src/providers/travelpayouts');
const clock = require('../src/utils/clock');
const { createApp } = require('../src/app');

const DAY = 24 * 60 * 60 * 1000;
const VALID_PLANS = JSON.stringify({
  checkIntervalMin: 180,
  free: { maxActiveAlerts: 1, digestEnabled: true, instantTotalMax: 0, searchesPerMonth: 10 },
  trial: { maxActiveAlerts: 3, digestEnabled: true, days: 7, instantTotalMax: 3 },
  pro: { maxActiveAlerts: 30, digestEnabled: true, instantPerDayMax: 5, days: 30 },
});

function authFor(user) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const params = new URLSearchParams({
    auth_date: String(Math.floor(clock.now().getTime() / 1000)),
    user: JSON.stringify(user),
  });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

function req(app, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const raw = body !== null
        ? (typeof body === 'string' ? body : JSON.stringify(body))
        : null;
      const defaultCt = typeof body === 'string'
        ? 'application/x-www-form-urlencoded'
        : 'application/json';
      const r = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          ...headers,
          ...(raw ? { 'Content-Type': headers['Content-Type'] || defaultCt, 'Content-Length': Buffer.byteLength(raw) } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* */ }
            resolve({ status: res.statusCode, headers: res.headers, text, json });
          });
        });
      });
      r.on('error', reject);
      if (raw) r.write(raw);
      r.end();
    });
  });
}

let prevNodeEnv;

beforeEach(() => {
  prevNodeEnv = process.env.NODE_ENV;
  cleanEnv();
  reset();
  clock.reset();
  clock.setNow(new Date('2026-10-10T15:00:00.000Z'));
  process.env.NODE_ENV = 'test';
  process.env.TELEGRAM_BOT_TOKEN = '123456:TEST_TOKEN';
  process.env.TELEGRAM_BOT_USERNAME = 'flightalertpro_bot';
  process.env.DEVICE_COOKIE_SECRET = 'test-dev-secret';
  process.env.FUNNEL_HMAC_SALT = 'test-funnel-salt';
  process.env.PUBLIC_BASE_URL = 'https://flightalert.example';
  process.env.FEATURE_SEARCH = 'on';
  process.env.FEATURE_ALERTS = 'on';
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.FEATURE_PAYMENTS_STRIPE = 'on';
  process.env.STRIPE_SECRET_KEY = 'sk_test_sim';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_sim';
  process.env.STRIPE_PRICE_EUR = 'price_eur_sim';
  process.env.STRIPE_PRICE_USD = 'price_usd_sim';
  process.env.PLAN_LIMITS_JSON = VALID_PLANS;
  process.env.INSTANT_ALERTS_TRIAL_MAX_TOTAL = '3';
  plans.reload();
  Stripe.constructEvent.mockReset();
  Stripe.create.mockReset();
  Stripe.subRetrieve.mockReset();
  Stripe.custRetrieve.mockReset();
});

afterEach(() => {
  delete process.env.PLAN_LIMITS_JSON;
  delete process.env.INSTANT_ALERTS_TRIAL_MAX_TOTAL;
  delete process.env.FUNNEL_HMAC_SALT;
  delete process.env.TEST_USER_ALLOWLIST;
  if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevNodeEnv;
  plans.resetForTest();
  cleanEnv();
  clock.reset();
});

describe('Simulación E2E Scenarios S1–S9', () => {
  test('S1/S2: Free cap 1 alerta, 2da alerta -> 402 PAYWALL, webSession origin -> checkout_open -> Stripe pro_paid (sin pisar comp)', async () => {
    await col('User').create({ telegramUserId: '301', telegramChatId: '301', lang: 'es' });
    await col('Entitlement').create({ telegramUserId: '301', plan: 'free', trialUsedAt: '2026-09-01T00:00:00.000Z' });
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 301, language_code: 'es' }) };

    const a1 = await req(app, 'POST', '/app/api/alerts', h, {
      origin: 'EZE', destination: 'MAD', outboundDate: '2026-12-10', ceiling: 700,
    });
    expect(a1.status).toBe(200);
    expect(a1.json.ok).toBe(true);

    const a2 = await req(app, 'POST', '/app/api/alerts', h, {
      origin: 'COR', destination: 'BCN', outboundDate: '2026-12-12', ceiling: 650,
    });
    expect(a2.status).toBe(402);
    expect(a2.json.error.code).toBe('PAYWALL');

    // Origin firmado viaja por webSession cookie -> POST /pro/checkout -> webhook Stripe pro_paid
    const token = webSession.sign('301', { origin: 'search_paywall' });
    const proGet = await req(app, 'GET', `/pro?s=${encodeURIComponent(token)}&origin=search_paywall`);
    expect(proGet.status).toBe(303);
    const cookie = (proGet.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');

    Stripe.create.mockResolvedValue({ id: 'cs_301', url: 'https://checkout.stripe.test/cs_301' });
    const co = await req(app, 'POST', '/pro/checkout', { Cookie: cookie }, 'email=u%40test.com&pais=ES');
    expect(co.status).toBe(303);

    const openEvt = await col('FunnelEvent').findOne({ event: 'pro_checkout_open' });
    expect(openEvt).toMatchObject({ origin: 'search_paywall', method: 'stripe' });

    const checkout = await col('Checkout').findOne({ telegramUserId: '301' });
    Stripe.subRetrieve.mockResolvedValue({
      metadata: { external_reference: checkout.externalReference },
      items: { data: [{ price: { id: 'price_eur_sim' } }] },
    });
    Stripe.constructEvent.mockImplementation((raw) => JSON.parse(raw.toString()));
    const wh = await stripePay.handleWebhook({
      body: Buffer.from(JSON.stringify({
        type: 'invoice.paid',
        created: Math.floor(clock.now().getTime() / 1000),
        data: { object: { id: 'in_s2', object: 'invoice', currency: 'eur', subscription: 'sub_s2', customer: 'cus_s2' } },
      })),
      headers: { 'stripe-signature': 'ok' },
    });
    expect(wh.status).toBe(200);
    const paidEvt = await col('FunnelEvent').findOne({ event: 'pro_paid' });
    expect(paidEvt).toMatchObject({ origin: 'search_paywall', method: 'stripe', subscriptionId: 'sub_s2' });

    // Comp no debe pisarse con pro_paid
    await col('Entitlement').create({ telegramUserId: '302', plan: 'pro', source: 'comp', proUntil: new Date(clock.now().getTime() + 10 * DAY).toISOString() });
    await entitlements.activatePro('302', 'stripe', 'ref-302', new Date(clock.now().getTime() + 30 * DAY), { source: 'stripe' });
    const compEnt = await col('Entitlement').findOne({ telegramUserId: '302' });
    expect(compEnt.source).toBe('comp');
  });

  test('S3/S4/S5: Trial 3 alertas, INSTANT_ALERTS_TRIAL_MAX_TOTAL=3 tope total entre corridas y baja conserva más reciente', async () => {
    await col('User').create({ telegramUserId: '401', telegramChatId: '401', lang: 'es' });
    await entitlements.startTrial('401', 'search');

    for (let i = 1; i <= 3; i += 1) {
      await col('Route').create({
        telegramUserId: '401',
        telegramChatId: '401',
        origin: 'EZE',
        destination: i === 1 ? 'MAD' : (i === 2 ? 'BCN' : 'FCO'),
        tripType: 'oneway',
        outboundDate: `2026-12-0${i}`,
        priceThreshold: 900,
        notify: 'drop',
        paused: false,
        updatedAt: new Date(clock.now().getTime() + i * 1000),
      });
    }

    const bot = { sendMessage: jest.fn().mockResolvedValue({}) };
    const tpSpy = jest.spyOn(travelpayouts, 'search').mockImplementation(async (q) => ([{
      origin: q.origin,
      destination: q.destination,
      departureDate: q.departureDate,
      price: 550,
      currency: 'EUR',
      stops: 1,
      durationMin: 700,
      foundAt: clock.now().toISOString(),
    }]));

    const r1 = await instantAlerts.run(bot);
    expect(r1.sent).toBe(3);

    // Día siguiente, nueva fecha/ruta o mismo trial: tope acumulado de 3 impide el 4to aviso del trial
    clock.setNow(new Date(clock.now().getTime() + 24 * 60 * 60 * 1000));
    await col('Route').updateMany({ telegramUserId: '401' }, { $set: { priceThreshold: 920 } });
    const r2 = await instantAlerts.run(bot);
    expect(r2.sent).toBe(0);
    tpSpy.mockRestore();

    // Al vencer trial: conserva la editada más reciente (FCO) y pausa las otras 2 con pausedReason='plan_limit'
    clock.setNow(new Date(clock.now().getTime() + 8 * DAY));
    await entitlements.expire(bot);
    const active = await col('Route').find({ telegramUserId: '401', paused: false }).lean();
    const paused = await col('Route').find({ telegramUserId: '401', paused: true }).lean();
    expect(active.map((r) => r.destination)).toEqual(['FCO']);
    expect(paused).toHaveLength(2);
    expect(paused.every((r) => r.pausedByBilling && r.pausedReason === 'plan_limit')).toBe(true);
  });

  test('S6/S7: Pro cap 30 -> 409 LIMIT_REACHED (sin upsell); vencimiento pausa y renovación reactiva solo las de facturación', async () => {
    await col('User').create({ telegramUserId: '501', telegramChatId: '501', lang: 'es' });
    await col('Entitlement').create({
      telegramUserId: '501',
      plan: 'pro',
      source: 'stripe',
      proUntil: new Date(clock.now().getTime() + 5 * DAY).toISOString(),
    });
    for (let i = 0; i < 30; i += 1) {
      await col('Route').create({
        telegramUserId: '501',
        telegramChatId: '501',
        origin: 'EZE',
        destination: 'MAD',
        tripType: 'oneway',
        outboundDate: `2027-01-${String((i % 28) + 1).padStart(2, '0')}`,
        paused: false,
      });
    }
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501, language_code: 'es' }) };
    const over = await req(app, 'POST', '/app/api/alerts', h, {
      origin: 'COR', destination: 'MAD', outboundDate: '2027-02-01', ceiling: 700,
    });
    expect(over.status).toBe(409);
    expect(over.json.error.code).toBe('LIMIT_REACHED');

    // Agrega una alerta pausada por usuario y una vencida que NO deben reactivarse al renovar
    await col('Route').updateOne({ telegramUserId: '501', outboundDate: '2027-01-01' }, { $set: { paused: true, pausedByBilling: false, pausedReason: 'user' } });
    await col('Route').create({
      telegramUserId: '501', telegramChatId: '501', origin: 'EZE', destination: 'BCN',
      tripType: 'oneway', outboundDate: '2026-01-01', paused: true, pausedByBilling: true, pausedReason: 'expired',
    });

    await entitlements.downgrade('501', 'grace_expired');
    await entitlements.activatePro('501', 'stripe', 'in_renew', new Date(clock.now().getTime() + 30 * DAY));
    const userPaused = await col('Route').findOne({ telegramUserId: '501', outboundDate: '2027-01-01' });
    const expiredRoute = await col('Route').findOne({ telegramUserId: '501', origin: 'EZE', destination: 'BCN' });
    const restoredCount = await col('Route').countDocuments({ telegramUserId: '501', paused: false });
    expect(userPaused.paused).toBe(true);
    expect(expiredRoute.paused).toBe(true);
    expect(restoredCount).toBe(29);
  });

  test('S8/S9: Idempotency-Key, If-Match 409 VERSION_CONFLICT, X-FA-Session-Id UUIDv4, Notification.status=sent en lastCheapAlert y /api/test/plan 404 en prod', async () => {
    await col('User').create({ telegramUserId: '601', telegramChatId: '601', lang: 'es' });
    await entitlements.startTrial('601', 'app');
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 601, language_code: 'es' }) };
    const uuid = crypto.randomUUID();

    const c1 = await req(app, 'POST', '/app/api/alerts', {
      ...h, 'Idempotency-Key': 'idem-abc', 'X-FA-From': 'search', 'X-FA-Session-Id': uuid,
    }, { origin: 'EZE', destination: 'MAD', outboundDate: '2026-12-20', ceiling: 700 });
    const c2 = await req(app, 'POST', '/app/api/alerts', {
      ...h, 'Idempotency-Key': 'idem-abc', 'X-FA-From': 'search', 'X-FA-Session-Id': uuid,
    }, { origin: 'EZE', destination: 'MAD', outboundDate: '2026-12-20', ceiling: 700 });
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c2.json.id).toBe(c1.json.id);
    expect(await col('Route').countDocuments({ telegramUserId: '601', deletedAt: null })).toBe(1);

    const searchEvt = await col('FunnelEvent').findOne({ event: 'alert_create_from_search', sessionId: uuid });
    expect(searchEvt).toBeTruthy();

    // UUID inválido crea alerta igual sin romper ni guardar sessionId inválido
    const c3 = await req(app, 'POST', '/app/api/alerts', {
      ...h, 'X-FA-From': 'search', 'X-FA-Session-Id': 'not-a-uuid',
    }, { origin: 'COR', destination: 'MAD', outboundDate: '2026-12-21', ceiling: 710 });
    expect(c3.status).toBe(200);

    // If-Match optimista
    const p1 = await req(app, 'PATCH', `/app/api/alerts/${c1.json.id}`, { ...h, 'If-Match': '"1"' }, { ceiling: 650 });
    expect(p1.status).toBe(200);
    expect(p1.json.item.version).toBe(2);
    const stalePatch = await req(app, 'PATCH', `/app/api/alerts/${c1.json.id}`, { ...h, 'If-Match': '"1"' }, { ceiling: 600 });
    expect(stalePatch.status).toBe(409);
    expect(stalePatch.json.error.code).toBe('VERSION_CONFLICT');

    // Notification.status='failed' ignorada por lastCheapAlert; 'sent' sí aparece
    await col('Notification').create({
      telegramUserId: '601', kind: 'instant', status: 'failed', origin: 'EZE', destination: 'MAD', price: 500, sentAtIso: '2026-10-10T16:00:00.000Z',
    });
    expect(await funnel.lastCheapAlert('601')).toBeNull();
    await col('Notification').create({
      telegramUserId: '601', kind: 'instant', status: 'sent', origin: 'EZE', destination: 'MAD', price: 540, sentAtIso: '2026-10-10T15:00:00.000Z',
    });
    const last = await funnel.lastCheapAlert('601');
    expect(last).toMatchObject({ status: 'sent', price: 540 });

    // /app/api/test/plan bloqueado en NODE_ENV=production
    process.env.NODE_ENV = 'production';
    const prodRes = await req(app, 'POST', '/app/api/test/plan', h, { plan: 'pro' });
    expect(prodRes.status).toBe(404);
  });
});
