'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => {
  const text = [];
  const on = {};
  return {
    onText(re, cb) { text.push({ re, cb }); },
    on(ev, cb) { on[ev] = cb; },
    sendMessage: jest.fn().mockResolvedValue({}),
    answerCallbackQuery: jest.fn().mockResolvedValue(true),
    answerPreCheckoutQuery: jest.fn().mockResolvedValue(true),
    setMyCommands: jest.fn().mockResolvedValue(true),
    createInvoiceLink: jest.fn().mockResolvedValue('https://t.me/invoice/test'),
    _text: text,
  };
}));

jest.mock('node-cron', () => ({ schedule: jest.fn() }));

const { cleanEnv } = require('./helpers');

function boot(extra) {
  jest.resetModules();
  cleanEnv();
  Object.assign(process.env, extra);
  const TelegramBot = require('node-telegram-bot-api');
  const cron = require('node-cron');
  TelegramBot.mockClear();
  cron.schedule.mockClear();
  const { start } = require('../src/app');
  const app = start();
  return { app, TelegramBot, cron };
}

function get(app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http.get({ port, path: urlPath }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
        });
      }).on('error', reject);
    });
  });
}

afterEach(() => cleanEnv());

test('P1. sin variables: /health 200 y el bot no hace polling', async () => {
  const { app, TelegramBot, cron } = boot({});
  expect(TelegramBot).not.toHaveBeenCalled();
  expect(cron.schedule).not.toHaveBeenCalled();
  const res = await get(app, '/health');
  expect(res.status).toBe(200);
  expect(res.body).toContain('ok');
});

test('P2. kill switch: el comando dice mantenimiento y los crons no se arman', async () => {
  const { app, TelegramBot, cron } = boot({
    TELEGRAM_BOT_TOKEN: 'test-token',
    PUBLIC_KILL_SWITCH: 'on',
  });
  expect(cron.schedule).not.toHaveBeenCalled();
  const bot = TelegramBot.mock.results.at(-1).value;
  const start = bot._text.find((h) => h.re.test('/start'));
  await start.cb({ chat: { id: 101 }, from: { id: 101 }, text: '/start' });
  expect(bot.sendMessage).toHaveBeenCalledWith(101, 'Estamos en mantenimiento, volvé en un rato');
  const res = await get(app, '/pro');
  expect(res.status).toBe(503);
  const daily = require('../src/services/dailyReport');
  const skipped = await daily.runDailyDigest(bot);
  expect(skipped).toEqual({ skipped: true });
  expect(bot.sendMessage).toHaveBeenCalledTimes(1);
});

test('P16. no hay playwright ni carpeta de scrapers', () => {
  const pkg = require('../package.json');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  expect(deps.playwright).toBeUndefined();
  expect(fs.existsSync(path.join(__dirname, '..', 'server', 'scrapers'))).toBe(false);
  expect(fs.existsSync(path.join(__dirname, '..', 'src', 'scrapers'))).toBe(false);
});

test('la cobertura de la v1 son 5 orígenes y 31 destinos', () => {
  const { ORIGINS, DESTINATIONS } = require('../src/config/airports');
  expect(ORIGINS).toHaveLength(5);
  expect(DESTINATIONS).toHaveLength(31);
});
