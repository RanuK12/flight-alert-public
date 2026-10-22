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

test('header correcto entrega el update; incorrecto o ausente da 401', async () => {
  const got = [];
  const bot = { processUpdate: (u) => got.push(u.update_id) };
  const h = t.webhookHandler(() => bot, PROD);
  const ok = fakeRes(); await h(req(SECRET, { update_id: 7 }), ok);
  expect(ok.code).toBe(200);
  const bad = fakeRes(); await h(req('otro_secreto_cualquiera_xx', { update_id: 8 }), bad);
  expect(bad.code).toBe(401);
  const none = fakeRes(); await h(req(undefined, { update_id: 9 }), none);
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

describe('auditoría webhook', () => {
  const TOKEN = '123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  beforeEach(() => { t.resetDedupe(); delete process.env.MONGODB_URI; });

  test('update_id duplicado se ignora (200, sin procesar dos veces)', async () => {
    const got = [];
    const h = t.webhookHandler(() => ({ processUpdate: (u) => got.push(u.update_id) }), PROD);
    const a = fakeRes(); await h(req(SECRET, { update_id: 41 }), a);
    const b = fakeRes(); await h(req(SECRET, { update_id: 41 }), b);
    const c = fakeRes(); await h(req(SECRET, { update_id: 42 }), c);
    expect(got).toEqual([41, 42]);
    expect(b.code).toBe(200);
    expect(b.body).toEqual({ ok: true, duplicate: true });
  });

  test('dedupe en memoria vence a las 24 h', async () => {
    expect(await t.firstTime(9, { now: 0 })).toBe(true);
    expect(await t.firstTime(9, { now: 1000 })).toBe(false);
    expect(await t.firstTime(9, { now: t.DEDUPE_TTL_MS + 2000 })).toBe(true);
  });

  test('modelo Mongo: índice único en updateId y TTL de 24 h', () => {
    const M = require('../src/database/models/TelegramUpdate');
    const idx = M.schema.indexes();
    expect(idx).toContainEqual([{ updateId: 1 }, expect.objectContaining({ unique: true })]);
    expect(idx).toContainEqual([{ createdAt: 1 }, expect.objectContaining({ expireAfterSeconds: 86400 })]);
  });

  test('Mongo: duplicate key (11000) = repetido', async () => {
    process.env.MONGODB_URI = 'mongodb://example.invalid/x';
    const M = require('../src/database/models/TelegramUpdate');
    const spy = jest.spyOn(M, 'create').mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 11000 }));
    try {
      expect(await t.firstTime(5)).toBe(true);
      expect(await t.firstTime(5)).toBe(false);
    } finally { spy.mockRestore(); delete process.env.MONGODB_URI; }
  });

  test('registerWebhook reintenta con backoff y no filtra el token', async () => {
    const waits = [];
    let n = 0;
    const bot = { setWebHook: jest.fn(async () => { n += 1; if (n < 3) throw new Error(`EFATAL https://api.telegram.org/bot${TOKEN}/setWebHook`); return true; }) };
    await expect(t.registerWebhook(bot, { ...PROD, TELEGRAM_BOT_TOKEN: TOKEN }, { sleep: async (ms) => waits.push(ms), baseMs: 100 })).resolves.toBe(true);
    expect(waits).toEqual([100, 200]);
    const bad = { setWebHook: jest.fn(async () => { throw new Error(`fail /bot${TOKEN}/x`); }) };
    const err = await t.registerWebhook(bad, { ...PROD, TELEGRAM_BOT_TOKEN: TOKEN }, { attempts: 3, sleep: async () => {} }).catch((e) => e);
    expect(bad.setWebHook).toHaveBeenCalledTimes(3);
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain('[token]');
  });

  test('redacción: token suelto, en URL y en description', () => {
    expect(t.redactToken(`x ${TOKEN} y`, TOKEN)).toBe('x [token] y');
    expect(t.redactToken('/botabc:def/getMe', '')).toBe('/bot[token]/getMe');
    const e = t.safeError({ message: `no ${TOKEN}`, code: 'ETELEGRAM', response: { body: { description: `bad ${TOKEN}` } } }, TOKEN);
    expect(JSON.stringify(e)).not.toContain(TOKEN);
  });

  test('logger nunca escribe el token en consola', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      require('../src/utils/logger').child('t').error('x', { message: `boom ${TOKEN}` });
      expect(spy.mock.calls[0][0]).not.toContain(TOKEN);
    } finally { spy.mockRestore(); }
  });

  test('getWebhookInfo para /health: url y last_error sin token ni query', async () => {
    const bot = { getWebHookInfo: async () => ({ url: 'https://ejemplo.test/webhooks/telegram?x=1', pending_update_count: 2, last_error_message: 'Wrong response', last_error_date: 100 }) };
    const i = await t.refreshInfo(bot, { now: 0 });
    expect(i).toMatchObject({ url: 'https://ejemplo.test/webhooks/telegram', pending: 2, lastError: 'Wrong response', lastErrorAt: '1970-01-01T00:01:40.000Z' });
    expect(t.webhookInfo().url).toBe(i.url);
  });

  test('producción sin PUBLIC_BASE_URL o secreto: falla fuerte, nunca polling', () => {
    expect(t.mode({ NODE_ENV: 'production' })).toBe('misconfigured');
    expect(t.mode({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: SECRET })).toBe('misconfigured');
    expect(() => t.assertConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://x.test' })).toThrow(/TELEGRAM_WEBHOOK_SECRET/);
    expect(() => t.assertConfig({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: SECRET })).toThrow(/PUBLIC_BASE_URL/);
    expect(() => t.assertConfig({ NODE_ENV: 'production', ...PROD })).not.toThrow();
    expect(() => t.assertConfig({})).not.toThrow();
  });
});
