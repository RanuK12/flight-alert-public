'use strict';

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const entitlements = require('../src/services/entitlements');
const { sendInforme } = require('../src/bot/handlers/informe');

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  process.env.FEATURE_ALERTS = 'on';
});

afterEach(() => cleanEnv());

test('P6. la prueba es una por cuenta y por dispositivo; el día 8 pausa y avisa una vez', async () => {
  clock.setNow(new Date('2026-10-01T15:00:00.000Z'));
  expect((await entitlements.startTrial('101', 'dev-a')).ok).toBe(true);
  expect((await entitlements.startTrial('101', 'dev-b')).ok).toBe(false);
  expect((await entitlements.startTrial('303', 'dev-a')).ok).toBe(false);

  await col('Entitlement').updateOne(
    { telegramUserId: '101' },
    { $set: { telegramChatId: '101' } },
  );
  await col('Route').create({
    telegramUserId: '101',
    telegramChatId: '101',
    origin: 'EZE',
    destination: 'MAD',
    tripType: 'oneway',
    outboundDate: '2026-12-01',
    paused: false,
  });

  const doc = await col('Entitlement').findOne({ telegramUserId: '101' });
  clock.setNow(new Date(new Date(doc.trialEndsAt).getTime() + 60 * 60 * 1000));
  const bot = { sendMessage: jest.fn().mockResolvedValue({}) };
  await entitlements.expire(bot);
  const route = await col('Route').findOne({ telegramUserId: '101' });
  expect(route.paused).toBe(true);
  expect(route.pausedByBilling).toBe(true);
  expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  await entitlements.expire(bot);
  expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  const after = await col('Entitlement').findOne({ telegramUserId: '101' });
  expect(after.plan).toBe('free');
});

test('P7. /informe le habla solo a quien lo pidió', async () => {
  const until = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  for (const id of ['101', '202']) {
    await col('Entitlement').updateOne(
      { telegramUserId: id },
      { $set: { plan: 'pro', proUntil: until, telegramChatId: id, telegramUserId: id } },
      { upsert: true },
    );
    await col('Route').create({
      telegramUserId: id,
      telegramChatId: id,
      origin: 'EZE',
      destination: 'MAD',
      tripType: 'oneway',
      outboundDate: '2026-12-01',
      paused: false,
      lastPriceEur: 500,
      stops: 1,
      durationMin: 700,
      foundAt: clock.now().toISOString(),
    });
  }
  const bot = { sendMessage: jest.fn().mockResolvedValue({}) };
  await sendInforme(bot, '101', '101');
  const chats = bot.sendMessage.mock.calls.map((call) => String(call[0]));
  expect(chats.length).toBeGreaterThan(0);
  expect(chats.every((chat) => chat === '101')).toBe(true);
  const blob = bot.sendMessage.mock.calls.map((call) => String(call[1])).join('\n');
  expect(blob.toLowerCase()).not.toContain('cuota');
  for (const call of bot.sendMessage.mock.calls) {
    const markup = call[2] && call[2].reply_markup;
    if (!markup) continue;
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.every((b) => b.url && !b.callback_data)).toBe(true);
  }
});
