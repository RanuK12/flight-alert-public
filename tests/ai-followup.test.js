'use strict';

const { cleanEnv } = require('./helpers');
const { reset } = require('../src/database');
const clock = require('../src/utils/clock');
const ai = require('../src/services/ai');
const { validate } = require('../src/services/ai/schema');
const naturalSearch = require('../src/bot/handlers/naturalSearch');
const buscar = require('../src/bot/handlers/buscar');

const good = JSON.stringify({ origen: 'COR', destino: 'MAD', fecha_ida: '2026-12-10', fecha_vuelta: null, flex_dias: 0 });

beforeEach(() => {
  cleanEnv(); reset(); ai._reset();
  process.env.GROQ_API_KEY = 'test-groq';
  clock.setNow(new Date('2026-10-22T12:00:00Z'));
  process.env.AI_ENABLED = 'true';
  delete process.env.ADMIN_TELEGRAM_IDS;
  delete process.env.OWNER_TELEGRAM_IDS;
});
afterAll(() => { clock.reset(); delete process.env.AI_ENABLED; delete process.env.GROQ_API_KEY; jest.restoreAllMocks(); });

test('(1) la cache incluye la fecha de hoy', async () => {
  const call = jest.fn(async () => ({ content: good, tokens: 1 }));
  const opts = { call, isPro: async () => true };
  await ai.parse(1, 'el viernes que viene a madrid', opts);
  expect((await ai.parse(1, 'el viernes que viene a madrid', opts)).source).toBe('cache');
  clock.setNow(new Date('2026-10-23T12:00:00Z'));
  expect((await ai.parse(1, 'el viernes que viene a madrid', opts)).source).toBe('ai');
  expect(call).toHaveBeenCalledTimes(2);
});

test('(2) rechaza departDate anterior a hoy (ART)', () => {
  const base = { origin: 'COR', destination: 'MAD' };
  expect(validate({ ...base, departDate: '2026-10-21' })).toMatchObject({ ok: false, error: 'past' });
  expect(validate({ ...base, departDate: '2026-10-22' }).ok).toBe(true);
  expect(validate({ ...base, departDate: '2026-10-21' }, { today: '2026-10-20' }).ok).toBe(true);
});

function fakeBot() { return { sendMessage: jest.fn(async () => ({})) }; }

test('(3) adults llega a replySearch', async () => {
  const spy = jest.spyOn(buscar, 'replySearch').mockResolvedValue({ status: 200 });
  jest.resetModules();
  jest.doMock('../src/bot/handlers/buscar', () => ({ replySearch: spy }));
  const ns = require('../src/bot/handlers/naturalSearch');
  const bot = fakeBot();
  await ns.handleText(bot, { chat: { id: 1 }, from: { id: 1 }, text: 'COR MAD 2026-12-10 3 adultos' });
  expect(spy).toHaveBeenCalledWith(bot, 1, 1, expect.objectContaining({ origin: 'COR', adults: 3 }));
  jest.dontMock('../src/bot/handlers/buscar');
});

test('(4) modelo Groq por defecto llama-3.1-8b-instant', () => {
  delete process.env.GROQ_MODEL;
  jest.isolateModules(() => {
    expect(require('../src/services/ai/providers').PROVIDERS[0].model).toBe('llama-3.1-8b-instant');
  });
});

describe('(5) upsell para Free', () => {
  test('free sin reglas: hint ES con CTA y sin IA', async () => {
    const call = jest.fn();
    const out = await ai.parse(9, 'quiero ir a madrid', { call, isPro: async () => false });
    expect(out.reason).toBe('not_pro');
    expect(call).not.toHaveBeenCalled();
  });
  test('handler responde el upsell ES/EN', async () => {
    jest.spyOn(require('../src/services/entitlements'), 'isPro').mockResolvedValue(false);
    for (const [code, re] of [['es', /Pro ✨/], ['en', /Pro feature ✨/]]) {
      const bot = fakeBot();
      const used = await naturalSearch.handleText(bot, { chat: { id: 2 }, from: { id: 2, language_code: code }, text: 'quiero ir a madrid' });
      expect(used).toBe(true);
      const [, text, extra] = bot.sendMessage.mock.calls[0];
      expect(text).toMatch(re);
      expect(text).toMatch(/\/pro/);
      expect(extra.reply_markup.inline_keyboard[0][0].callback_data).toBeTruthy();
    }
  });
  test('también con AI_ENABLED off', async () => {
    delete process.env.AI_ENABLED;
    const out = await ai.parse(9, 'quiero ir a madrid', { isPro: async () => false });
    expect(out.reason).toBe('not_pro');
  });
});
