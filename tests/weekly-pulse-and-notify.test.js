'use strict';

jest.mock('../src/providers/travelpayouts', () => ({
  search: jest.fn(),
  searchRange: jest.fn(),
}));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true) }));

const fs = require('fs');
const path = require('path');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const travelpayouts = require('../src/providers/travelpayouts');
const notifier = require('../src/bot/notifier');
const instant = require('../src/services/instantAlerts');
const weeklyPulse = require('../src/services/weeklyPulse');
const scheduler = require('../src/services/scheduler');
const ux = require('../src/bot/ux');
const cb = require('../src/bot/ux/cb');

const HOUR = 60 * 60 * 1000;
const at = (iso) => clock.setNow(new Date(iso));

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  process.env.TELEGRAM_BOT_USERNAME = 'flightalertpro_bot';
  process.env.MINIAPP_SHORT_NAME = 'app';
  travelpayouts.search.mockReset();
  travelpayouts.searchRange.mockReset();
  notifier.send.mockClear();
});

afterEach(() => {
  cleanEnv();
  clock.reset();
});

describe('instantAlerts respeta notify: drop vs daily', () => {
  test('envía alerta instantánea para notify=drop y omite notify=daily', async () => {
    at('2026-11-19T15:00:00.000Z');
    for (const id of ['10', '11']) {
      await col('Entitlement').create({
        telegramUserId: id,
        plan: 'pro',
        proUntil: new Date(clock.now().getTime() + 20 * 24 * HOUR).toISOString(),
      });
    }
    await col('Route').create({
      telegramUserId: '10',
      telegramChatId: '10',
      origin: 'EZE',
      destination: 'MAD',
      tripType: 'oneway',
      outboundDate: '2026-12-10',
      priceThreshold: 550,
      notify: 'drop',
      paused: false,
      lang: 'es',
    });
    await col('Route').create({
      telegramUserId: '11',
      telegramChatId: '11',
      origin: 'EZE',
      destination: 'MAD',
      tripType: 'oneway',
      outboundDate: '2026-12-10',
      priceThreshold: 550,
      notify: 'daily',
      paused: false,
      lang: 'es',
    });

    travelpayouts.search.mockResolvedValue([{
      origin: 'EZE',
      destination: 'MAD',
      departureDate: '2026-12-10',
      returnDate: null,
      price: 490,
      stops: 1,
      foundAt: new Date(clock.now().getTime() - HOUR).toISOString(),
      currency: 'EUR',
    }]);

    const out = await instant.run({});
    expect(out.sent).toBe(1);
    expect(notifier.send).toHaveBeenCalledTimes(1);
    const [, chatId, text, extra] = notifier.send.mock.calls[0];
    expect(chatId).toBe('10');
    expect(text).toContain('Ahorrás €60');
    expect(extra.reply_markup.inline_keyboard[0]).toHaveLength(2);
    expect(extra.reply_markup.inline_keyboard[0][1].url).toContain('startapp=alert_');
  });
});

describe('weeklyPulse: novedades semanales, opt-out e idempotencia', () => {
  test('arma mensaje con ofertas reales, respeta opt-out y blocked, e idempotencia semanal', async () => {
    at('2026-11-23T14:00:00.000Z'); // Lunes 11:00 ART
    await col('User').create({ telegramUserId: '1', telegramChatId: '1', firstName: 'Emilio', lang: 'es', blocked: false, weeklyPulseOptOut: false });
    await col('User').create({ telegramUserId: '2', telegramChatId: '2', firstName: 'Ana', lang: 'pt', blocked: false, weeklyPulseOptOut: false });
    await col('User').create({ telegramUserId: '3', telegramChatId: '3', firstName: 'Muted', lang: 'es', blocked: false, weeklyPulseOptOut: true });
    await col('User').create({ telegramUserId: '4', telegramChatId: '4', firstName: 'Gone', lang: 'en', blocked: true, weeklyPulseOptOut: false });
    await col('Route').create({
      telegramUserId: '1', telegramChatId: '1', origin: 'EZE', destination: 'FLN',
      tripType: 'oneway', outboundDate: '2026-12-10', paused: false,
    });

    travelpayouts.searchRange.mockImplementation(async (q) => [{
      origin: q.origin,
      destination: q.destination,
      departureDate: '2026-12-15',
      price: q.destination === 'FLN' ? 350 : 620,
      currency: 'EUR',
      foundAt: clock.now().toISOString(),
    }]);

    const bot = { sendMessage: jest.fn().mockResolvedValue({ message_id: 1 }) };
    const first = await weeklyPulse.run(bot, { dryRun: false, sleep: async () => {} });
    expect(first.targeted).toBe(2);
    expect(first.sent).toBe(2);
    expect(first.skippedOptOut).toBe(1);
    expect(first.skippedBlocked).toBe(1);
    expect(first.dealsCount).toBe(3);

    const [chat1, text1, extra1] = bot.sendMessage.mock.calls[0];
    expect(chat1).toBe('1');
    expect(text1).toContain('¡Hola Emilio!');
    expect(text1).toContain('€350');
    expect(text1).toContain('1 alerta(s) activa(s)');
    expect(extra1.reply_markup.inline_keyboard[1][0].callback_data).toBe(cb.encode('s', 'poff'));

    const [chat2, text2] = bot.sendMessage.mock.calls[1];
    expect(chat2).toBe('2');
    expect(text2).toContain('Olá, Ana!');

    // Segunda corrida en la misma semana no reenvía a nadie (idempotente)
    const second = await weeklyPulse.run(bot, { dryRun: false, sleep: async () => {} });
    expect(second.sent).toBe(0);
    expect(second.skippedAlreadySent).toBe(2);
  });

  test('callback s|poff y s|pon actualiza weeklyPulseOptOut en User', async () => {
    await col('User').create({ telegramUserId: '77', telegramChatId: '77', lang: 'es', weeklyPulseOptOut: false });
    const bot = {
      answerCallbackQuery: jest.fn().mockResolvedValue(true),
      editMessageText: jest.fn().mockResolvedValue(true),
      sendMessage: jest.fn().mockResolvedValue({ message_id: 2 }),
    };
    await ux.onCallback(bot, {
      id: 'q1',
      data: cb.encode('s', 'poff'),
      from: { id: 77, language_code: 'es' },
      message: { chat: { id: 77 }, message_id: 10 },
    });
    let u = await col('User').findOne({ telegramUserId: '77' }).lean();
    expect(u.weeklyPulseOptOut).toBe(true);

    await ux.onCallback(bot, {
      id: 'q2',
      data: cb.encode('s', 'pon'),
      from: { id: 77, language_code: 'es' },
      message: { chat: { id: 77 }, message_id: 10 },
    });
    u = await col('User').findOne({ telegramUserId: '77' }).lean();
    expect(u.weeklyPulseOptOut).toBe(false);
  });

  test('scheduler.weeklyAt calcula la ventana semanal más reciente en ART', () => {
    const win = scheduler.weeklyAt(1, 11); // Lunes 11:00 ART
    // Jueves 19 Nov 2026 17:00 ART (20:00 UTC) -> lunes 16 Nov 2026 11:00 ART
    const r = win(new Date('2026-11-19T20:00:00.000Z'));
    expect(r.key).toBe('2026-11-16T11');
    // Lunes 23 Nov 2026 11:05 ART (14:05 UTC) -> lunes 23 Nov 2026 11:00 ART
    const r2 = win(new Date('2026-11-23T14:05:00.000Z'));
    expect(r2.key).toBe('2026-11-23T11');
  });

  test('Mini App incluye selector visual de modo de aviso y badges instant/daily', () => {
    const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'app.css'), 'utf8');
    expect(js).toContain('notifyPicker');
    expect(js).toContain('badgeInstant');
    expect(js).toContain('badgeDaily');
    expect(css).toContain('.mode-card');
    expect(css).toContain('.badge.instant');
    expect(css).toContain('.badge.daily');
  });
});
