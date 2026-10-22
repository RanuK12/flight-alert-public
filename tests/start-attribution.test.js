'use strict';

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const start = require('../src/bot/handlers/start');

beforeEach(() => { cleanEnv(); reset(); });

test('startParam sanea el payload y descarta link_ y vacío', () => {
  expect(start.startParam('x')).toBe('x');
  expect(start.startParam('tg_ar')).toBe('tg_ar');
  expect(start.startParam('li<script>')).toBe('liscript');
  expect(start.startParam('a'.repeat(100))).toHaveLength(64);
  expect(start.startParam('link_abc')).toBeNull();
  expect(start.startParam('')).toBeNull();
});

test('attribution guarda id y payload, sin otros datos', async () => {
  start.attribution(42, 'tg_es');
  await new Promise((r) => setTimeout(r, 10));
  const doc = await col('StartEvent').findOne({ telegramUserId: '42' });
  expect(doc.startParam).toBe('tg_es');
  const keys = Object.keys(doc).filter((k) => !k.startsWith('_') && k !== 'id');
  expect(keys.sort()).toEqual(['at', 'startParam', 'telegramUserId']);
});

test('/start sin payload no registra nada', async () => {
  start.attribution(42, '');
  await new Promise((r) => setTimeout(r, 10));
  expect(await col('StartEvent').findOne({ telegramUserId: '42' })).toBeFalsy();
});
