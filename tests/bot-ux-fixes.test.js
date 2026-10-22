'use strict';

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const webSession = require('../src/web/webSession');
const instant = require('../src/services/instantAlerts');
const { t } = require('../src/bot/ux/i18n');

beforeEach(() => { cleanEnv(); clock.reset(); process.env.DEVICE_COOKIE_SECRET = 'test-secret-not-real'; });
afterEach(() => { delete process.env.DEVICE_COOKIE_SECRET; });

describe('token de sesión web', () => {
  test('firma, verifica y vence a los 15 min', () => {
    clock.setNow(new Date('2026-10-22T15:00:00Z'));
    const tok = webSession.sign(4242);
    expect(webSession.verify(tok)).toBe('4242');
    clock.setNow(new Date('2026-10-22T15:16:00Z'));
    expect(webSession.verify(tok)).toBeNull();
  });

  test('rechaza tokens alterados o de otra clave', () => {
    const tok = webSession.sign(1);
    const [body, sig] = tok.split('.');
    const forged = Buffer.from(JSON.stringify({ u: '2', exp: Date.now() + 1e6, n: 'x' })).toString('base64url');
    expect(webSession.verify(`${forged}.${sig}`)).toBeNull();
    expect(webSession.verify(`${body}.${sig.slice(0, -2)}AA`)).toBeNull();
    expect(webSession.verify('basura')).toBeNull();
    process.env.DEVICE_COOKIE_SECRET = 'otra';
    expect(webSession.verify(tok)).toBeNull();
  });

  test('/pro?s= pasa el token a cookie HttpOnly y limpia la URL', async () => {
    const { createApp } = require('../src/app');
    const server = createApp().listen(0);
    await new Promise((r) => server.once('listening', r));
    const tok = webSession.sign(77);
    const res = await fetch(`http://127.0.0.1:${server.address().port}/pro?s=${encodeURIComponent(tok)}`, { redirect: 'manual' });
    server.close();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/pro');
    expect(res.headers.get('set-cookie')).toMatch(/fa_s=.*HttpOnly.*Path=\/pro.*Max-Age=900/);
  });
});

test('/pro dice "dólar oficial" sin BNA', () => {
  expect(t('es', 'proArs', { ars: '1' })).toMatch(/dólar oficial\)/);
  expect(t('es', 'proArs', { ars: '1' })).not.toMatch(/BNA/);
  expect(t('en', 'proArs', { ars: '1' })).not.toMatch(/BNA/);
});

describe('alertas flexibles respetan la vuelta', () => {
  const base = { origin: 'EZE', destination: 'MAD', tripType: 'roundtrip', outboundDate: '2026-12-01' };
  const f = (dep, ret) => ({ departureDate: dep, returnDate: ret, price: 500 });

  test('mes flexible + fecha de vuelta fija', () => {
    const r = { ...base, flexMonth: '2026-12', returnDate: '2027-01-05' };
    const { kind, q } = instant.queryFor(r, new Date('2026-10-22T15:00:00Z'));
    expect(kind).toBe('range');
    expect(q).toMatchObject({ months: ['2026-12'], oneway: false, returnDate: '2027-01-05' });
    expect(instant.matchesRoute(r, f('2026-12-10', '2027-01-05'))).toBe(true);
    expect(instant.matchesRoute(r, f('2026-12-10', '2027-01-06'))).toBe(false);
    expect(instant.matchesRoute(r, f('2026-12-10', null))).toBe(false);
  });

  test('próximos 3 meses + noches fijas', () => {
    const r = { ...base, flexMonth: 'next3', stayDays: 14, returnDate: '2026-12-15' };
    const { q } = instant.queryFor(r, new Date('2026-10-22T15:00:00Z'));
    expect(q).toMatchObject({ months: ['2026-10', '2026-11', '2026-12'], stay: 14, returnDate: null });
    expect(instant.matchesRoute(r, f('2026-11-01', '2026-11-15'))).toBe(true);
    expect(instant.matchesRoute(r, f('2026-11-01', '2026-11-20'))).toBe(false);
  });

  test('solo ida flexible no acepta ida y vuelta', () => {
    const r = { ...base, tripType: 'oneway', flexMonth: '2026-12' };
    expect(instant.matchesRoute(r, f('2026-12-10', null))).toBe(true);
    expect(instant.matchesRoute(r, f('2026-12-10', '2026-12-20'))).toBe(false);
  });
});
