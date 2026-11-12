'use strict';

const http = require('http');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const stars = require('../src/services/payments/stars');
const starsRecovery = require('../src/services/payments/starsRecovery');
const entitlements = require('../src/services/entitlements');
const plans = require('../src/config/plans');
const clock = require('../src/utils/clock');
const { createApp } = require('../src/app');

const VALID_PLANS = JSON.stringify({
  checkIntervalMin: 180,
  free: { maxActiveAlerts: 1, digestEnabled: true, instantTotalMax: 0, searchesPerMonth: 10 },
  trial: { maxActiveAlerts: 3, digestEnabled: true, days: 7, instantTotalMax: 3 },
  pro: { maxActiveAlerts: 30, digestEnabled: true, instantPerDayMax: 5, days: 30 },
});

function get(app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => server.close(() => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') })));
      }).on('error', reject);
    });
  });
}

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  process.env.STARS_PAYLOAD_SECRET = 'test-stars-secret';
  process.env.PLAN_LIMITS_JSON = VALID_PLANS;
  plans.reload();
});

afterEach(() => {
  delete process.env.PLAN_LIMITS_JSON;
  delete process.env.SUPPORT_CONTACT;
  plans.resetForTest();
  cleanEnv();
  clock.reset();
});

describe('Stars Startup Guard, Webhook Path Parity & Recovery Queue', () => {
  test('assertStartupConfig falla si FEATURE_PAYMENTS_STARS=on sin SUPPORT_CONTACT; pasa si off o con SUPPORT_CONTACT', () => {
    process.env.FEATURE_PAYMENTS_STARS = 'on';
    delete process.env.SUPPORT_CONTACT;
    expect(() => stars.assertStartupConfig()).toThrow(/SUPPORT_CONTACT/);

    process.env.SUPPORT_CONTACT = '@ranuk_support';
    expect(() => stars.assertStartupConfig()).not.toThrow();

    process.env.FEATURE_PAYMENTS_STARS = 'off';
    delete process.env.SUPPORT_CONTACT;
    expect(() => stars.assertStartupConfig()).not.toThrow();
  });

  test('/paysupport y UI de Stars se ocultan cuando FEATURE_PAYMENTS_STARS=off', async () => {
    const startHandler = require('../src/bot/handlers/start');
    const handlers = [];
    const bot = {
      onText: jest.fn((re, fn) => handlers.push({ re, fn })),
      sendMessage: jest.fn().mockResolvedValue({}),
    };
    startHandler.register(bot);
    const paySupport = handlers.find((h) => h.re.test('/paysupport'));
    expect(paySupport).toBeTruthy();

    process.env.FEATURE_PAYMENTS_STARS = 'off';
    const app = createApp();
    expect((await get(app, '/es')).text).not.toContain('name="ccy" value="stars"');
    await paySupport.fn({ chat: { id: 101 }, from: { id: 101, language_code: 'es' } });
    expect(bot.sendMessage).not.toHaveBeenCalled();

    process.env.FEATURE_PAYMENTS_STARS = 'on';
    process.env.SUPPORT_CONTACT = '@ranuk_support';
    expect((await get(app, '/es')).text).toContain('name="ccy" value="stars"');
    await paySupport.fn({ chat: { id: 101 }, from: { id: 101, language_code: 'es' } });
    expect(bot.sendMessage).toHaveBeenCalledWith(101, expect.stringContaining('@ranuk_support'));
  });

  test('claim atómico, lock expirado a 5 min y sweep recupera o reembolsa y escala a admin', async () => {
    const t0 = new Date('2026-10-10T10:00:00.000Z');
    clock.setNow(t0);

    const c1 = await starsRecovery.claim({ chargeId: 'chg-lock', userId: '101', totalAmount: 250 });
    expect(c1.status).toBe('claimed');

    // Llamada concurrente antes de 5 min recibe in_flight
    clock.setNow(new Date(t0.getTime() + 60 * 1000));
    const c2 = await starsRecovery.claim({ chargeId: 'chg-lock', userId: '101', totalAmount: 250 });
    expect(c2.status).toBe('in_flight');

    // Después de 5 min sin terminar, otro worker recupera el lock huérfano
    clock.setNow(new Date(t0.getTime() + 6 * 60 * 1000));
    const bot = { sendMessage: jest.fn().mockResolvedValue({}) };
    const s1 = await starsRecovery.sweep(bot);
    expect(s1.orphansRecovered).toBe(1);
    const doneRow = await col('StarCharge').findOne({ chargeId: 'chg-lock' });
    expect(doneRow.work).toBe('done');
    expect(doneRow.outcome).toBe('credit');
    expect((await col('Entitlement').findOne({ telegramUserId: '101' })).plan).toBe('pro');
  });

  test('fallo al activar intenta reembolso; si refundStarPayment falla, encola StarRefund y luego escala a StarCredit + admin', async () => {
    const t0 = new Date('2026-10-10T12:00:00.000Z');
    clock.setNow(t0);
    process.env.ADMIN_TELEGRAM_IDS = '99';

    const failSpy = jest.spyOn(entitlements, 'activatePro').mockRejectedValueOnce(new Error('db_write_err'));
    const bot = {
      refundStarPayment: jest.fn().mockRejectedValue(new Error('refund_timeout')),
      sendMessage: jest.fn().mockResolvedValue({}),
    };
    const payload = await stars.issuePayload('202', 'search_paywall');
    const res = await stars.onSuccess({
      from: { id: '202' },
      chat: { id: '202' },
      successful_payment: { telegram_payment_charge_id: 'chg-fail', currency: 'XTR', total_amount: 250, invoice_payload: payload },
    }, { bot });
    failSpy.mockRestore();

    expect(res.ok).toBe(false);
    expect(res.refundPending).toBe(true);
    let refundRow = await col('StarRefund').findOne({ chargeId: 'chg-fail' });
    expect(refundRow.status).toBe('pending');

    // Avanza reloj para agotar MAX_ATTEMPTS en sweep
    for (let i = 0; i < starsRecovery.MAX_ATTEMPTS; i += 1) {
      clock.setNow(new Date(clock.now().getTime() + 24 * 60 * 60 * 1000));
      await starsRecovery.sweep(bot);
    }

    refundRow = await col('StarRefund').findOne({ chargeId: 'chg-fail' });
    expect(refundRow.status).toBe('exhausted');
    const creditRow = await col('StarCredit').findOne({ chargeId: 'chg-fail' });
    expect(creditRow).toBeTruthy();
    expect(bot.sendMessage).toHaveBeenCalledWith('99', expect.stringContaining('chg-fail'));
  });
});
