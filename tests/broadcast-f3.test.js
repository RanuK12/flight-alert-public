'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const broadcast = require('../src/services/broadcast');
const airports = require('../src/config/airports');
const coverage = require('../src/config/coverage');
const places = require('../src/bot/ux/places');

let covFile;

beforeEach(() => {
  cleanEnv();
  reset();
  clock.reset();
  delete process.env.FEATURE_F3_DESTINATIONS;
  delete process.env.BROADCAST_ALLOWLIST;
  delete process.env.COVERAGE_FILE;
  delete process.env.MINIAPP_SHORT_NAME;
  process.env.TELEGRAM_BOT_USERNAME = 'flightalertpro_bot';
  process.env.MINIAPP_SHORT_NAME = 'app';
  covFile = path.join(os.tmpdir(), `cov-f3-${process.pid}-${Date.now()}.json`);
});

afterEach(() => {
  delete process.env.FEATURE_F3_DESTINATIONS;
  delete process.env.BROADCAST_ALLOWLIST;
  delete process.env.COVERAGE_FILE;
  delete process.env.MINIAPP_SHORT_NAME;
  try { fs.unlinkSync(covFile); } catch (_) { /* */ }
  cleanEnv();
  clock.reset();
});

describe('Phase 3: Broadcast idempotente + Destinos F3 (US/PY/CN/TH/SG)', () => {
  test('dryRun=true no envía ni bloquea envíos futuros', async () => {
    await col('User').create({ telegramUserId: '101', telegramChatId: '101', blocked: false });
    await col('User').create({ telegramUserId: '102', telegramChatId: '102', blocked: false });
    await col('User').create({ telegramUserId: '103', telegramChatId: '103', blocked: true });

    const bot = { sendMessage: jest.fn() };
    const dry = await broadcast.sendCampaign(bot, {
      campaignKey: 'f3_launch',
      text: 'Sumamos nuevos destinos.',
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.targeted).toBe(2);
    expect(dry.skippedBlocked).toBe(1);
    expect(dry.sent).toBe(0);
    expect(bot.sendMessage).not.toHaveBeenCalled();
    expect(await col('BroadcastSend').find({ campaignKey: 'f3_launch' }).lean()).toHaveLength(0);

    const live = await broadcast.sendCampaign(bot, {
      campaignKey: 'f3_launch',
      text: 'Sumamos nuevos destinos.',
      dryRun: false,
      sleep: async () => {},
    });
    expect(live.sent).toBe(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard[0][0].url).toContain('startapp=novedades');

    // Segunda corrida con la misma campaignKey: at-most-once
    const again = await broadcast.sendCampaign(bot, {
      campaignKey: 'f3_launch',
      text: 'Sumamos nuevos destinos.',
      dryRun: false,
      sleep: async () => {},
    });
    expect(again.sent).toBe(0);
    expect(again.skippedAlreadySent).toBe(2);
    expect(bot.sendMessage).toHaveBeenCalledTimes(2);
  });

  test('broadcast respeta allowlist, throttling <=25 msg/s, reintenta 429 retry_after y marca 403 como blocked', async () => {
    await col('User').create({ telegramUserId: '201', telegramChatId: '201' });
    await col('User').create({ telegramUserId: '202', telegramChatId: '202' });
    await col('User').create({ telegramUserId: '203', telegramChatId: '203' });

    const sleeps = [];
    const sleep = async (ms) => { sleeps.push(ms); };
    let tries201 = 0;
    const bot = {
      sendMessage: jest.fn(async (chatId) => {
        if (chatId === '201' && tries201++ === 0) {
          const err = new Error('Too Many Requests: retry after 2');
          err.response = { statusCode: 429, body: { parameters: { retry_after: 2 } } };
          throw err;
        }
        if (chatId === '202') {
          const err = new Error('Forbidden: bot was blocked by the user');
          err.response = { statusCode: 403 };
          throw err;
        }
        return {};
      }),
    };

    const res = await broadcast.sendCampaign(bot, {
      campaignKey: 'pilot_allow',
      text: 'Prueba piloto',
      dryRun: false,
      allowlist: ['201', '202'],
      sleep,
    });
    expect(res.skippedNotAllowlisted).toBe(1);
    expect(res.sent).toBe(1);
    expect(res.blocked).toBe(1);
    expect(sleeps.some((ms) => ms >= 2000)).toBe(true);

    const u202 = await col('User').findOne({ telegramUserId: '202' });
    expect(u202.blocked).toBe(true);
    const send202 = await col('BroadcastSend').findOne({ campaignKey: 'pilot_allow', telegramUserId: '202' });
    expect(send202.status).toBe('blocked');
  });

  test('FEATURE_F3_DESTINATIONS habilita ASU + US/CN/TH/SG con umbral >=60% sin romper AR->EU grandfathered', () => {
    expect(airports.activeOrigins()).not.toContain('ASU');
    expect(airports.activeDestinations()).not.toContain('MIA');
    expect(coverage.pairAllowed('EZE', 'MAD')).toBe(true);

    process.env.FEATURE_F3_DESTINATIONS = 'on';
    expect(airports.activeOrigins()).toContain('ASU');
    for (const code of ['MIA', 'JFK', 'LAX', 'ORD', 'DFW', 'SFO', 'ATL', 'MCO', 'PVG', 'PEK', 'CAN', 'BKK', 'HKT', 'SIN']) {
      expect(airports.activeDestinations()).toContain(code);
      expect(places.PLACES[code] && places.PLACES[code].city).toBeTruthy();
    }

    fs.writeFileSync(covFile, JSON.stringify({
      withData: [
        { origin: 'ASU', destination: 'MIA' },
        { origin: 'ASU', destination: 'MAD' },
        { origin: 'ASU', destination: 'BKK' },
      ],
      byOrigin: {
        ASU: { withData: 30, total: 45, percent: 67 },
      },
      minOriginPercent: 60,
    }));
    process.env.COVERAGE_FILE = covFile;

    expect(coverage.pairAllowed('ASU', 'MIA')).toBe(true);
    expect(coverage.pairAllowed('ASU', 'BKK')).toBe(true);
    expect(coverage.pairAllowed('ASU', 'SIN')).toBe(false);
    // AR->EU sigue intacto sin necesidad de aparecer en coverage.json
    expect(coverage.pairAllowed('EZE', 'MAD')).toBe(true);
    expect(coverage.pairAllowed('COR', 'FCO')).toBe(true);
  });
});
