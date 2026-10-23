'use strict';

jest.mock('stripe', () => {
  const constructEvent = jest.fn();
  const sessionsCreate = jest.fn(async (s) => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/cs_test_1', ...s }));
  const customersCreate = jest.fn(async () => ({ id: 'cus_test_1' }));
  const Stripe = jest.fn(() => ({ webhooks: { constructEvent }, checkout: { sessions: { create: sessionsCreate } }, customers: { create: customersCreate } }));
  Stripe.constructEvent = constructEvent;
  Stripe.sessionsCreate = sessionsCreate;
  return Stripe;
});
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn(async () => ({ data: {} })), put: jest.fn() }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const { ORIGINS, DESTINATIONS, ORIGIN_GROUPS } = require('../src/config/airports');
const flow = require('../src/bot/ux/flow');
const cb = require('../src/bot/ux/cb');
const places = require('../src/bot/ux/places');
const instant = require('../src/services/instantAlerts');
const miniapp = require('../src/web/miniapp');
const pages = require('../src/web/pages');
const stripePay = require('../src/services/payments/stripe');
const stars = require('../src/services/payments/stars');
const country = require('../src/services/country');

const NEW = ['GRU', 'GIG', 'SCL', 'MVD', 'LIM', 'BOG', 'MEX'];

beforeEach(() => { cleanEnv(); reset(); clock.reset(); process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret'; });
afterEach(() => cleanEnv());

describe.each(['b', 'a'])('flujo %s: selector de origen', (fl) => {
  test('muestra cada origen nuevo bajo su país y el callback lo elige', () => {
    const r = flow.render('es', fl, {}, { now: new Date('2026-10-23T15:00:00Z') });
    const btns = r.keyboard ? r.keyboard.inline_keyboard.flat() : (r.reply_markup || r).inline_keyboard.flat();
    const titles = btns.filter((b) => b.callback_data === 'noop').map((b) => b.text);
    for (const g of ORIGIN_GROUPS) expect(titles).toContain(`${g.flag} ${g.name}`);
    for (const code of ORIGINS) {
      const b = btns.find((x) => x.text === places.label(code));
      expect(b).toBeTruthy();
      expect(cb.decode(b.callback_data).fields.o).toBe(code);
    }
  });
});

test.each(NEW)('%s: después de elegir origen pide destino con los 31 de Europa', (code) => {
  const r = flow.render('es', 'b', { o: code }, { now: new Date('2026-10-23T15:00:00Z') });
  const kb = (r.keyboard || r.reply_markup || r).inline_keyboard.flat();
  const dests = kb.map((b) => { try { return cb.decode(b.callback_data).fields.d; } catch { return null; } }).filter(Boolean);
  expect(dests.length).toBeGreaterThan(0);
  dests.forEach((d) => expect(DESTINATIONS).toContain(d));
});

test('alias: "rio" no elige solo (también matchea Rosario) y ofrece GIG; "rio de janeiro" sí', () => {
  const r = places.match('rio', 'o');
  expect(r.exact).toBeNull();
  expect(r.matches).toEqual(expect.arrayContaining(['GIG', 'ROS']));
  expect(places.match('rio de janeiro', 'o').exact).toBe('GIG');
  expect(places.match('sao paulo', 'o').exact).toBe('GRU');
  expect(places.match('São Paulo', 'o').exact).toBe('GRU');
  expect(places.match('bogota', 'o').exact).toBe('BOG');
  expect(places.match('lima', 'o').exact).toBe('LIM');
});

test.each(NEW)('%s: alerta → consulta, match y aviso con el código correcto', (code) => {
  const now = new Date('2026-10-23T15:00:00Z');
  const route = { origin: code, destination: 'MAD', tripType: 'roundtrip', flexMonth: 'next3', stayDays: 14, priceThreshold: 700 };
  const q = instant.queryFor(route, now);
  expect(q.kind).toBe('range');
  expect(q.q.origin).toBe(code);
  const f = { origin: code, destination: 'MAD', departureDate: '2026-12-01', returnDate: '2026-12-15', price: 650, foundAt: now.toISOString() };
  expect(instant.matchesRoute(route, f)).toBe(true);
  const msg = instant.messageFor(route, f, now);
  expect(msg).toContain(`${code} → MAD`);
  expect(msg).toContain('€650');
  expect(instant.groupKey({ ...route, outboundDate: '2026-12-01' })).toContain(code);
});

test('mini-app: lista los orígenes nuevos con país', () => {
  const p = miniapp.placesPayload();
  for (const code of NEW) {
    const o = p.origins.find((x) => x.code === code);
    expect(o).toBeTruthy();
    expect(o.country).toBeTruthy();
  }
});

test('página Pro: países LATAM en la lista, con precio en USD y sin MP', () => {
  for (const [c, name] of [['BR', 'Brasil'], ['CL', 'Chile'], ['UY', 'Uruguay'], ['PE', 'Perú'], ['CO', 'Colombia'], ['MX', 'México']]) {
    const html = pages.pro({ choice: c, ipCountry: c });
    expect(html).toContain(`<option value="${c}" selected>${name}</option>`);
    expect(html).toMatch(c === "BR" ? /US\$5 por mês/ : /US\$5 por mes/); // Brasil ve la página en pt-BR
    expect(html).not.toContain('Podés pagar en pesos con Mercado Pago');
    expect(country.currencyFor(c, c).rail).toBe('stripe');
  }
});

test('Stripe (test): checkout de Brasil va en USD y el webhook da Pro', async () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec-test';
  process.env.STRIPE_PRICE_USD = 'price_usd_test';
  const Stripe = require('stripe');
  const offer = country.currencyFor('BR', 'BR');
  await col('Checkout').create({ externalReference: 'ref-br', telegramUserId: '202', provider: 'stripe', currency: offer.currency });
  const s = await stripePay.createCheckout({ externalReference: 'ref-br', currency: offer.currency, unitAmount: offer.unitAmount, customerEmail: 'a@b.co', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
  expect(s.line_items[0].price_data).toMatchObject({ currency: 'usd', unit_amount: 500 });
  clock.setNow(new Date('2026-10-23T15:00:00Z'));
  Stripe.constructEvent.mockImplementationOnce(() => ({
    type: 'checkout.session.completed',
    created: Math.floor(clock.now().getTime() / 1000),
    data: { object: { id: 'cs_test_1', client_reference_id: 'ref-br', currency: 'usd', amount_total: 500 } },
  }));
  const res = await stripePay.handleWebhook({ body: Buffer.from('{}'), headers: { 'stripe-signature': 't' } });
  expect(res.status || 200).toBe(200);
  const ent = await col('Entitlement').findOne({ telegramUserId: '202' });
  expect(ent.plan).toBe('pro');
});

test('Stars: crea la factura XTR de 250 para un usuario de cualquier país', async () => {
  process.env.FEATURE_PAYMENTS_STARS = 'on';
  const bot = { createInvoiceLink: jest.fn(async () => 'https://t.me/$inv'), sendMessage: jest.fn(async () => ({})) };
  await stars.sendInvoice(bot, '303', '303');
  const args = bot.createInvoiceLink.mock.calls[0];
  expect(args[4]).toBe('XTR');
  expect(args[5][0].amount).toBe(250);
  expect(bot.sendMessage).toHaveBeenCalled();
});

describe.each([['GRU', 'MAD'], ['MAD', 'EZE']])('e2e bot %s→%s: botones → consulta → alerta', (o, d) => {
  test('se elige por callbacks, valida, arma la consulta y el monitor la busca', async () => {
    const now = new Date('2026-10-23T15:00:00Z');
    const kb = (r) => (r.keyboard || r.reply_markup || r).inline_keyboard.flat();
    const pick = (r, key, val) => kb(r).map((b) => { try { return cb.decode(b.callback_data).fields; } catch { return null; } })
      .find((f) => f && f[key] === val);
    let f = pick(flow.render('es', 'b', {}, { now }), 'o', o);
    expect(f).toBeTruthy();
    f = pick(flow.render('es', 'b', f, { now }), 'd', d);
    expect(f).toBeTruthy();
    f = { ...f, m: '2612', t: '1' };
    expect(flow.validate('es', f, now)).toBeNull();
    const q = flow.toQuery(f, now);
    expect([q.origin, q.destination]).toEqual([o, d]);
    clock.setNow(new Date('2026-10-21T15:00:00Z'));
    process.env.FEATURE_INSTANT_ALERTS = 'on';
    await col('Entitlement').create({ telegramUserId: '5', plan: 'pro', searchesUsed: 0, proUntil: '2026-12-31T00:00:00Z' });
    await col('Route').create({ telegramUserId: '5', telegramChatId: '5', origin: o, destination: d, tripType: 'oneway', outboundDate: '2026-12-10', returnDate: null, priceThreshold: 500, paused: false });
    const tp = require('../src/providers/travelpayouts');
    const spy = jest.spyOn(tp, 'search').mockResolvedValue([]);
    await instant.run({});
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ origin: o, destination: d }));
    spy.mockRestore();
  });
});
