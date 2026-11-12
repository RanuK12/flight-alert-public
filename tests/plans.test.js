'use strict';

const http = require('http');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const plans = require('../src/config/plans');
const entitlements = require('../src/services/entitlements');
const clock = require('../src/utils/clock');
const logger = require('../src/utils/logger');
const { createApp } = require('../src/app');

function req(app, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const raw = body ? JSON.stringify(body) : null;
      const r = http.request({
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          ...headers,
          ...(raw ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            let json = null;
            try { json = JSON.parse(text); } catch (_) { /* */ }
            resolve({ status: res.statusCode, text, json });
          });
        });
      });
      r.on('error', reject);
      if (raw) r.write(raw);
      r.end();
    });
  });
}

const VALID_PLANS = {
  checkIntervalMin: 180,
  free: { maxActiveAlerts: 1, digestEnabled: true, instantTotalMax: 0, searchesPerMonth: 10 },
  trial: { maxActiveAlerts: 3, digestEnabled: true, days: 7, instantTotalMax: 3 },
  pro: { maxActiveAlerts: 30, digestEnabled: true, instantPerDayMax: 5, days: 30 },
};

const VALID_JSON = JSON.stringify(VALID_PLANS);

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  delete process.env.PLAN_LIMITS_JSON;
  plans.resetForTest();
});

afterEach(() => {
  plans.resetForTest();
  delete process.env.PLAN_LIMITS_JSON;
  cleanEnv();
  clock.reset();
});

describe('PlanConfig loader, DB override, y modo seguro (PLAN_CONFIG_UNAVAILABLE)', () => {
  test('PLAN_LIMITS_JSON faltante o inválido entra en source=safe y /health devuelve 200', async () => {
    plans.reload();
    expect(plans.isSafeMode()).toBe(true);
    expect(plans.health()).toMatchObject({ ok: false, source: 'safe' });

    const app = createApp();
    const h = await req(app, 'GET', '/health');
    expect(h.status).toBe(200);
    expect(h.json.ok).toBe(true);
    expect(h.json.planConfig).toMatchObject({ ok: false, source: 'safe' });

    process.env.PLAN_LIMITS_JSON = '{bad-json';
    plans.reload();
    expect(plans.isSafeMode()).toBe(true);

    process.env.PLAN_LIMITS_JSON = JSON.stringify({ free: { maxActiveAlerts: -1 } });
    plans.reload();
    expect(plans.isSafeMode()).toBe(true);
  });

  test('en modo seguro create/reactivate falla con 503 PLAN_CONFIG_UNAVAILABLE sin quemar el trial', async () => {
    plans.reload();
    const gateNew = await entitlements.canCreateOrReactivate('701', { isNew: true });
    expect(gateNew.ok).toBe(false);
    expect(gateNew.status).toBe(503);
    expect(gateNew.code).toBe('PLAN_CONFIG_UNAVAILABLE');
    const ent = await col('Entitlement').findOne({ telegramUserId: '701' });
    expect(ent).toBeNull();
  });

  test('PLAN_LIMITS_JSON válido carga limits dinámicos y DB override prevalece; DB inválido conserva el último válido', async () => {
    process.env.PLAN_LIMITS_JSON = VALID_JSON;
    plans.reload();
    expect(plans.isSafeMode()).toBe(false);
    expect(plans.current().free.maxActiveAlerts).toBe(1);
    expect(plans.current().pro.maxActiveAlerts).toBe(30);

    await col('PlanConfig').create({
      key: 'active',
      plans: {
        ...VALID_PLANS,
        free: { ...VALID_PLANS.free, maxActiveAlerts: 2 },
        pro: { ...VALID_PLANS.pro, maxActiveAlerts: 40 },
      },
    });
    const r1 = await plans.refreshFromDb();
    expect(r1).toMatchObject({ source: 'db', ok: true });
    expect(plans.current().free.maxActiveAlerts).toBe(2);
    expect(plans.current().pro.maxActiveAlerts).toBe(40);

    await col('PlanConfig').updateOne({ key: 'active' }, { $set: { plans: { broken: true } } });
    const r2 = await plans.refreshFromDb();
    expect(r2.source).toBe('db');
    expect(r2.invalidDb).toBeTruthy();
    expect(plans.current().free.maxActiveAlerts).toBe(2);
    expect(plans.current().pro.maxActiveAlerts).toBe(40);
  });

  test('log de plan_config_unavailable tiene rate limit de 1 por hora', () => {
    const start = new Date('2026-10-10T10:00:00.000Z');
    clock.setNow(start);
    const spy = jest.spyOn(logger, 'child');
    delete process.env.PLAN_LIMITS_JSON;
    plans.resetForTest();
    plans.reload();
    const afterFirst = logger.recent(50).filter((l) => l.includes('plan_config_unavailable')).length;
    clock.setNow(new Date(start.getTime() + 10 * 60 * 1000));
    plans.reload();
    const afterSoon = logger.recent(50).filter((l) => l.includes('plan_config_unavailable')).length;
    expect(afterSoon).toBe(afterFirst);

    clock.setNow(new Date(start.getTime() + 65 * 60 * 1000));
    plans.reload();
    const afterHour = logger.recent(50).filter((l) => l.includes('plan_config_unavailable')).length;
    expect(afterHour).toBeGreaterThan(afterSoon);
    spy.mockRestore();
  });
});
