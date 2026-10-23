'use strict';
const mode = require('../src/services/payments/mode');

const APP = 'APP_' + 'USR-' + 'fake-abc';
const TST = 'TEST-' + 'fake-abc';
const KEYS = ['PAYMENTS_MODE', 'MP_TEST_USER', 'MP_ACCESS_TOKEN', 'STRIPE_SECRET_KEY'];
let saved;
beforeEach(() => { saved = {}; KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; }); });
afterEach(() => { KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); });

test('test mode: TEST- ok, prefijo live rechazado sin flag', () => {
  process.env.PAYMENTS_MODE = 'test';
  expect(() => mode.assertMpKey(TST)).not.toThrow();
  expect(() => mode.assertMpKey(APP)).toThrow('MP_ACCESS_TOKEN debe ser de test');
  process.env.MP_ACCESS_TOKEN = APP;
  expect(() => mode.assertConfigured()).toThrow('MP_ACCESS_TOKEN debe ser de test');
});

test('test mode + MP_TEST_USER=1: prefijo live de cuenta de prueba aceptado', () => {
  process.env.PAYMENTS_MODE = 'test';
  process.env.MP_TEST_USER = '1';
  expect(() => mode.assertMpKey(APP)).not.toThrow();
  process.env.MP_ACCESS_TOKEN = APP;
  expect(() => mode.assertConfigured()).not.toThrow();
  expect(() => mode.assertMpKey('otro')).toThrow();
});

test('live no cambia: solo prefijo live, TEST- rechazado aunque haya flag', () => {
  process.env.PAYMENTS_MODE = 'live';
  process.env.MP_TEST_USER = '1';
  expect(() => mode.assertMpKey(APP)).not.toThrow();
  expect(() => mode.assertMpKey(TST)).toThrow('MP_ACCESS_TOKEN no coincide con PAYMENTS_MODE=live');
});

test('isMpTestUser lee el tag test_user de /users/me', async () => {
  const get = jest.fn().mockResolvedValue({ data: { tags: ['normal', 'test_user'] } });
  expect(await mode.isMpTestUser(APP, get)).toBe(true);
  get.mockResolvedValue({ data: { tags: ['normal'] } });
  expect(await mode.isMpTestUser(APP, get)).toBe(false);
});
