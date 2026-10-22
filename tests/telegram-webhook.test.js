'use strict';
const t = require('../src/bot/transport');

const SECRET = 'test_secret_not_real_0123456789';
const PROD = { TELEGRAM_WEBHOOK_SECRET: SECRET, PUBLIC_BASE_URL: 'https://ejemplo.test/' };

function fakeRes() {
  const r = { code: 0, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.end = () => r;
  r.json = (b) => { r.body = b; return r; };
  return r;
}
function req(header, body) {
  return { get: (h) => (h.toLowerCase() === 'x-telegram-bot-api-secret-token' ? header : undefined), body };
}

test('modo: webhook con secreto+URL, polling local por defecto, off con TELEGRAM_POLLING=false', () => {
  expect(t.mode(PROD)).toBe('webhook');
  expect(t.mode({})).toBe('polling');
  expect(t.mode({ TELEGRAM_POLLING: 'false' })).toBe('off');
  expect(t.mode({ TELEGRAM_WEBHOOK_SECRET: SECRET })).toBe('polling');
  expect(t.webhookUrl(PROD)).toBe('https://ejemplo.test/webhooks/telegram');
});

test('header correcto entrega el update; incorrecto o ausente da 401', () => {
  const got = [];
  const bot = { processUpdate: (u) => got.push(u.update_id) };
  const h = t.webhookHandler(() => bot, PROD);
  const ok = fakeRes(); h(req(SECRET, { update_id: 7 }), ok);
  expect(ok.code).toBe(200);
  const bad = fakeRes(); h(req('otro_secreto_cualquiera_xx', { update_id: 8 }), bad);
  expect(bad.code).toBe(401);
  const none = fakeRes(); h(req(undefined, { update_id: 9 }), none);
  expect(none.code).toBe(401);
  expect(got).toEqual([7]);
});

test('sin modo webhook la ruta responde 404; body inválido 400', () => {
  const bot = { processUpdate: jest.fn() };
  const off = fakeRes(); t.webhookHandler(() => bot, {})(req(SECRET, { update_id: 1 }), off);
  expect(off.code).toBe(404);
  const bad = fakeRes(); t.webhookHandler(() => bot, PROD)(req(SECRET, { nope: 1 }), bad);
  expect(bad.code).toBe(400);
  expect(bot.processUpdate).not.toHaveBeenCalled();
});

test('registerWebhook manda secret_token y rechaza secretos inválidos', async () => {
  const calls = [];
  const bot = { setWebHook: async (url, opts) => { calls.push([url, opts]); return true; } };
  await t.registerWebhook(bot, PROD);
  expect(calls[0][0]).toBe('https://ejemplo.test/webhooks/telegram');
  expect(calls[0][1].secret_token).toBe(SECRET);
  await expect(t.registerWebhook(bot, { ...PROD, TELEGRAM_WEBHOOK_SECRET: 'corto' })).rejects.toThrow('inválido');
  expect(t.validSecret('con espacios no vale 1234')).toBe(false);
});

test('startBot: con secreto no hace polling y registra el webhook; sin secreto hace polling', () => {
  jest.isolateModules(() => {
    const instances = [];
    jest.doMock('node-telegram-bot-api', () => function Fake(token, opts) {
      this.opts = opts; instances.push(this);
      this.on = () => {}; this.onText = () => {};
      this.setMyCommands = () => Promise.resolve();
      this.setWebHook = jest.fn(() => Promise.resolve(true));
      this.answerPreCheckoutQuery = () => Promise.resolve();
    });
    const saved = { ...process.env };
    Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'x', ...PROD });
    delete process.env.TELEGRAM_POLLING;
    const b = require('../src/bot');
    b.resetBot();
    const bot = b.startBot();
    expect(bot.opts.polling).toBe(false);
    expect(bot.setWebHook).toHaveBeenCalledTimes(1);
    b.resetBot();
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const bot2 = b.startBot();
    expect(bot2.opts.polling).toBe(true);
    expect(bot2.setWebHook).not.toHaveBeenCalled();
    b.resetBot();
    process.env = saved;
  });
});
