'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn(async () => []), searchRange: jest.fn(async () => []) }));

const http = require('http');
const fs = require('fs');
const path = require('path');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const travelpayouts = require('../src/providers/travelpayouts');
const miniapp = require('../src/bot/miniapp');
const initData = require('../src/web/initData');
const web = require('../src/web/miniapp');
const ux = require('../src/bot/ux');
const cb = require('../src/bot/ux/cb');

const NOW = new Date('2026-10-22T15:00:00Z');
const TOKEN = 'test:not-a-real-token';
const BASE = 'https://flightalert.ranuk.dev';

function fakeBot() {
  const bot = { sent: [], edits: [], n: 10 };
  bot.sendMessage = jest.fn(async (chatId, text, extra) => { bot.n += 1; bot.sent.push({ chatId, text, extra }); return { message_id: bot.n }; });
  bot.editMessageText = jest.fn(async (text, extra) => { bot.edits.push({ text, extra }); return true; });
  bot.answerCallbackQuery = jest.fn(async () => {});
  bot.setMyCommands = jest.fn(async () => true);
  bot.setChatMenuButton = jest.fn(async () => true);
  bot.onText = jest.fn();
  return bot;
}
const es = { id: 501, language_code: 'es' };
const en = { id: 502, language_code: 'en' };
const msgOf = (from, text) => ({ chat: { id: from.id }, from, text });

function authFor(user, ageS = 60) {
  return initData.sign({ auth_date: String(Math.floor(NOW.getTime() / 1000) - ageS), query_id: 'q', user: JSON.stringify(user) }, TOKEN);
}

function call(app, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const data = body ? JSON.stringify(body) : null;
      const req = http.request({ port: server.address().port, path: urlPath, method, headers: { ...headers, ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => server.close(() => {
          const text = Buffer.concat(chunks).toString();
          let json = null; try { json = JSON.parse(text); } catch (_) { /* html */ }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        }));
      });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  });
}

beforeEach(() => {
  cleanEnv(); reset(); rateLimit.reset(); clock.setNow(NOW);
  web._calCache.clear();
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_POLLING = 'false';
  process.env.FEATURE_SEARCH = 'on';
  process.env.FEATURE_ALERTS = 'on';
  delete process.env.MINIAPP_ENABLED;
  travelpayouts.searchRange.mockReset();
  travelpayouts.searchRange.mockResolvedValue([]);
});
afterAll(() => { clock.reset(); cleanEnv(); });

describe('teclado persistente de abajo', () => {
  test('ES y EN: 5 botones, persistente, resize y placeholder; Buscar abre la Mini App si está lista', () => {
    for (const lang of ['es', 'en']) {
      const kb = miniapp.keyboard(lang);
      expect(kb.is_persistent).toBe(true);
      expect(kb.resize_keyboard).toBe(true);
      expect(kb.input_field_placeholder).toBeTruthy();
      const texts = kb.keyboard.flat().map((b) => b.text);
      expect(texts).toEqual(miniapp.ACTIONS.filter((a) => a !== 'admin').map((a) => miniapp.KEY_TEXT[lang][a]));
      expect(kb.keyboard[0][0].web_app).toEqual({ url: `${BASE}/app` });
    }
    expect(miniapp.KEY_TEXT.es).toEqual({ search: '🔎 Buscar vuelo', alerts: '🔔 Mis alertas', pro: '⭐ Pro', help: '❓ Ayuda', settings: '⚙️ Ajustes', admin: '🛠 Admin' });
  });

  test('sin Mini App lista (sin base https o MINIAPP_ENABLED=false), Buscar va al flujo por chat', () => {
    // Sin PUBLIC_BASE_URL se usa el dominio canónico (baseUrl()).
    expect(miniapp.keyboard('es', {}).keyboard[0][0].web_app).toEqual({ url: 'https://flightalert.ranuk.dev/app' });
    expect(miniapp.keyboard('es', { PUBLIC_BASE_URL: BASE, MINIAPP_ENABLED: 'false' }).keyboard[0][0].web_app).toBeUndefined();
    expect(miniapp.keyboard('es', { PUBLIC_BASE_URL: 'http://localhost:4310' }).keyboard[0][0].web_app).toBeUndefined();
  });

  test('cada texto de botón (ES y EN) mapea a su acción; otro texto no', () => {
    for (const lang of ['es', 'en']) {
      for (const a of miniapp.ACTIONS) expect(miniapp.actionFor(miniapp.KEY_TEXT[lang][a])).toBe(a);
    }
    expect(miniapp.actionFor('⚙ Ajustes')).toBe('settings'); // sin el selector de variación
    expect(miniapp.actionFor('madrid')).toBeNull();
    expect(miniapp.actionFor('/pro')).toBeNull();
  });

  test('botón y comando corren el mismo handler', async () => {
    process.env.ADMIN_TELEGRAM_IDS = String(es.id);
    const bot = fakeBot();
    const spies = {};
    for (const a of miniapp.ACTIONS) spies[a] = jest.spyOn(ux.HANDLERS, a).mockResolvedValue(undefined);
    try {
      for (const a of miniapp.ACTIONS) {
        const action = await ux.onKeyboard(bot, msgOf(es, miniapp.KEY_TEXT.es[a]));
        expect(action).toBe(a);
        expect(spies[a]).toHaveBeenCalledTimes(1);
      }
      expect(await ux.onKeyboard(bot, msgOf(es, 'hola'))).toBe(false);
      // Comandos → misma acción.
      const cmd = { '/alertas': 'alerts', '/alerts': 'alerts', '/mis_alertas': 'alerts', '/my_alerts': 'alerts', '/pro': 'pro', '/ayuda': 'help', '/help': 'help', '/ajustes': 'settings', '/settings': 'settings' };
      for (const [text, action] of Object.entries(cmd)) {
        const route = ux.COMMAND_ROUTES.find(([re]) => re.test(text));
        expect(route && route[1]).toBe(action);
      }
    } finally {
      Object.values(spies).forEach((s) => s.mockRestore());
    }
  });

  test('🔔 Mis alertas sin alertas muestra el vacío con Crear la primera', async () => {
    const bot = fakeBot();
    await ux.onKeyboard(bot, msgOf(es, '🔔 Mis alertas'));
    expect(bot.sent[0].text).toBe('No tenés alertas todavía.');
  });

  test('⚙️ Settings en EN responde en inglés y deja el teclado', async () => {
    const bot = fakeBot();
    await ux.onKeyboard(bot, msgOf(en, '⚙️ Settings'));
    expect(bot.sent[0].text).toMatch(/^Settings/);
    expect(bot.sent[0].extra.reply_markup.is_persistent).toBe(true);
  });
});

describe('menú, comandos y /start', () => {
  test('setup: setMyCommands ES y EN con 4 comandos y botón Menu web_app', async () => {
    const bot = fakeBot();
    await miniapp.setup(bot);
    const names = ['start', 'buscar', 'alertas', 'pro', 'ayuda'];
    expect(bot.setMyCommands.mock.calls[0].length).toBe(1); // ES por defecto
    expect(bot.setMyCommands.mock.calls[0][0].map((c) => c.command)).toEqual(names);
    expect(bot.setMyCommands.mock.calls[0][0][1].description).toBe('Buscar un vuelo');
    expect(bot.setMyCommands.mock.calls[1][0].map((c) => c.command)).toEqual(names);
    expect(bot.setMyCommands.mock.calls[1][0][1].description).toBe('Search a flight');
    expect(bot.setMyCommands.mock.calls[1][1]).toEqual({ language_code: 'en' });
    // Idempotente: correrlo de nuevo hace las mismas llamadas.
    await miniapp.setup(bot);
    expect(bot.setMyCommands.mock.calls[2]).toEqual(bot.setMyCommands.mock.calls[0]);
    expect(bot.setMyCommands.mock.calls[3]).toEqual(bot.setMyCommands.mock.calls[1]);
    expect(bot.setChatMenuButton).toHaveBeenCalledWith({ menu_button: JSON.stringify({ type: 'web_app', text: 'Buscar ✈', web_app: { url: `${BASE}/app` } }) });
    expect(miniapp.menuButton('en').text).toBe('Search ✈');
  });

  test('/start de un usuario que ya existía: home con teclado persistente y panel inline mínimo', async () => {
    const bot = fakeBot();
    await ux.welcome(bot, msgOf(es, '/start'), { isNew: false });
    expect(bot.setChatMenuButton).toHaveBeenCalledWith({ chat_id: 501, menu_button: expect.stringContaining('"type":"web_app"') });
    expect(bot.sent[0].extra.reply_markup.is_persistent).toBe(true);
    const inline = bot.sent[1].extra.reply_markup.inline_keyboard;
    expect(inline[0][0].web_app).toEqual({ url: `${BASE}/app` });
    expect(inline[1].map((b) => b.text)).toEqual(['🔔 Mis alertas', '⭐ Pro']);
  });

  test('onboarding en 3 toques hasta la alerta creada, y después el teclado', async () => {
    const bot = fakeBot();
    await ux.welcome(bot, msgOf(es, '/start'), { isNew: true });
    expect(bot.sent[0].text).toBe('Hola, soy Flight Alert. Te aviso cuando baja el precio de tu vuelo a Europa. ¿Desde dónde salís?');
    const kb = (m) => m.extra.reply_markup.inline_keyboard.flat();
    const tap = (data, mid) => ux.onCallback(bot, { id: 'x', data, from: es, message: { chat: { id: 501 }, message_id: mid } });
    const cor = kb(bot.sent[0]).find((b) => /COR/.test(b.text));
    await tap(cor.callback_data, 11);
    expect(bot.edits[0].text).toBe('¿A dónde querés ir?');
    const mad = bot.edits[0].extra.reply_markup.inline_keyboard.flat().find((b) => /MAD/.test(b.text));
    await tap(mad.callback_data, 11);
    expect(bot.edits[1].text).toMatch(/^Listo: COR → MAD\. ¿Te creo una alerta diaria\? Tenés 7 días de prueba de Pro\.$/);
    const create = bot.edits[1].extra.reply_markup.inline_keyboard.flat().find((b) => b.text === '🔔 Crear alerta');
    await tap(create.callback_data, 11);
    const routes = await col('Route').find({ telegramUserId: '501' }).lean();
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ origin: 'COR', destination: 'MAD', notify: 'daily' });
    expect(bot.sent.some((m) => m.extra && m.extra.reply_markup && m.extra.reply_markup.is_persistent)).toBe(true);
  });

  test('Saltar va al home', async () => {
    const bot = fakeBot();
    await ux.onCallback(bot, { id: 'x', data: cb.encode('o', 'sk'), from: es, message: { chat: { id: 501 }, message_id: 11 } });
    expect(bot.sent.some((m) => m.extra && m.extra.reply_markup && m.extra.reply_markup.is_persistent)).toBe(true);
  });

  test('copy sin "en vivo", "24/7", "tiempo real" ni "al instante"', () => {
    const files = ['src/bot/ux/i18n.js', 'src/bot/copy.js', 'src/bot/miniapp.js', 'public/app/app.js'];
    for (const f of files) {
      expect(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).not.toMatch(/en vivo|24\/7|tiempo real|al instante|instant alert/i);
    }
  });
});

describe('initData', () => {
  test('firma válida, alterada y vencida', () => {
    const now = NOW.getTime();
    const ok = initData.validate(authFor({ id: 501 }), TOKEN, { now });
    expect(ok).toMatchObject({ ok: true, user: { id: 501 } });
    const tampered = authFor({ id: 501 }).replace(encodeURIComponent('"id":501'), encodeURIComponent('"id":777'));
    expect(initData.validate(tampered, TOKEN, { now }).ok).toBe(false);
    expect(initData.validate(authFor({ id: 501 }, 3601), TOKEN, { now })).toMatchObject({ ok: false, reason: 'expired' });
    expect(initData.validate(authFor({ id: 501 }), 'otro:token', { now }).ok).toBe(false);
    expect(initData.validate('', TOKEN, { now }).ok).toBe(false);
  });
});

describe('/app', () => {
  const { createApp } = require('../src/app');

  test('HTML con CSP propia: telegram.org y frame-ancestors de Telegram', async () => {
    const res = await call(createApp(), 'GET', '/app');
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[a-f0-9]+' https:\/\/telegram\.org/);
    expect(res.headers['content-security-policy']).toMatch(/frame-ancestors https:\/\/web\.telegram\.org/);
    expect(res.text).toMatch(/telegram-web-app\.js/);
    const js = await call(createApp(), 'GET', '/app/app.js');
    expect(js.status).toBe(200);
  });

  test('API sin initData, vencido o alterado → 401', async () => {
    const app = createApp();
    expect((await call(app, 'GET', '/app/api/places')).status).toBe(401);
    expect((await call(app, 'GET', '/app/api/places', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }, 4000) } })).status).toBe(401);
    expect((await call(app, 'GET', '/app/api/places', { headers: { 'X-Telegram-Init-Data': `${authFor({ id: 501 })}x` } })).status).toBe(401);
    const ok = await call(app, 'GET', '/app/api/places', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }) } });
    expect(ok.status).toBe(200);
    expect(ok.json.origins.map((p) => p.code)).toContain('COR');
  });

  test('calendario: solo precios reales, terciles, sin inventar días', async () => {
    const seen = new Date(NOW.getTime() - 3 * 3600 * 1000).toISOString();
    const row = (day, price) => ({ origin: 'COR', destination: 'MAD', departureDate: day, returnDate: null, price, currency: 'EUR', stops: 1, foundAt: seen });
    travelpayouts.searchRange.mockResolvedValue([row('2026-11-03', 500), row('2026-11-03', 480), row('2026-11-05', 700), row('2026-11-09', 900)]);
    const res = await call(createApp(), 'GET', '/app/api/calendar?o=COR&d=MAD&m=2611', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }) } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual([
      { day: '2026-11-03', price: 480, currency: 'EUR', seen_at: seen, level: 'cheap' },
      { day: '2026-11-05', price: 700, currency: 'EUR', seen_at: seen, level: 'mid' },
      { day: '2026-11-09', price: 900, currency: 'EUR', seen_at: seen, level: 'high' },
    ]);
    const bad = await call(createApp(), 'GET', '/app/api/calendar?o=MAD&d=COR&m=2611', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }) } });
    expect(bad.status).toBe(400);
  });

  test('alertas: el user.id sale del initData, no del body; pausar, techo y borrar', async () => {
    const mine = await col('Route').create({ telegramUserId: '501', telegramChatId: '501', origin: 'COR', destination: 'MAD', tripType: 'oneway', outboundDate: '2026-11-10', paused: false, priceThreshold: 600 });
    await col('Route').create({ telegramUserId: '999', telegramChatId: '999', origin: 'EZE', destination: 'BCN', tripType: 'oneway', paused: false });
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501 }) };
    const app = createApp();
    const list = await call(app, 'GET', '/app/api/alerts', { headers: h });
    expect(list.json.map((a) => a.origin)).toEqual(['COR']);
    const id = String(mine._id);
    expect((await call(app, 'POST', `/app/api/alerts/${id}/pause`, { headers: h, body: { paused: true, telegramUserId: '999' } })).json).toEqual({ ok: true, paused: true });
    expect((await call(app, 'PATCH', `/app/api/alerts/${id}`, { headers: h, body: { ceiling: 550 } })).json).toEqual({ ok: true, ceiling: 550 });
    expect((await call(app, 'PATCH', `/app/api/alerts/${id}`, { headers: h, body: { ceiling: 5 } })).status).toBe(400);
    const other = await call(app, 'GET', '/app/api/alerts', { headers: { 'X-Telegram-Init-Data': authFor({ id: 999 }) } });
    expect((await call(app, 'DELETE', `/app/api/alerts/${other.json[0].id}`, { headers: h })).status).toBe(404);
    expect((await call(app, 'DELETE', `/app/api/alerts/${id}`, { headers: h })).json).toEqual({ ok: true });
    expect(await col('Route').find({ telegramUserId: '501' }).lean()).toHaveLength(0);
  });

  test('búsqueda: tarjetas con link de afiliado de la misma ruta, fechas y pasajeros', async () => {
    const seen = new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString();
    travelpayouts.searchRange.mockResolvedValue([{ origin: 'COR', destination: 'MAD', departureDate: '2026-11-12', returnDate: '2026-11-28', price: 510, currency: 'EUR', stops: 1, foundAt: seen }]);
    const res = await call(createApp(), 'POST', '/app/api/search', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }) }, body: { o: 'COR', d: 'MAD', dep: '2026-11-12', ret: '2026-11-28', adults: 2 } });
    expect(res.status).toBe(200);
    expect(res.json.results[0]).toMatchObject({ price: 510, currency: 'EUR', seen_at: seen });
    expect(res.json.results[0].url).toMatch(/^https:\/\/www\.aviasales\.com\/search\/COR1211MAD28112\?/);
  });

  test('MINIAPP_ENABLED=false: 404 en /app, assets y /app/api/*', async () => {
    process.env.MINIAPP_ENABLED = 'false';
    const app = createApp();
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501 }) };
    for (const p of ['/app', '/app/app.js', '/app/api/places', '/app/api/alerts']) expect((await call(app, 'GET', p, { headers: h })).status).toBe(404);
    expect((await call(app, 'POST', '/app/api/search', { headers: h, body: { o: 'COR', d: 'MAD' } })).status).toBe(404);
    expect(miniapp.keyboard('es').keyboard[0][0].web_app).toBeUndefined();
  });

  test('id de alerta inválido → 400 (pausar, editar, borrar)', async () => {
    const h = { 'X-Telegram-Init-Data': authFor({ id: 501 }) };
    const app = createApp();
    expect((await call(app, 'POST', '/app/api/alerts/xyz/pause', { headers: h, body: { paused: true } })).status).toBe(400);
    expect((await call(app, 'PATCH', '/app/api/alerts/%24ne', { headers: h, body: { ceiling: 500 } })).status).toBe(400);
    expect((await call(app, 'DELETE', '/app/api/alerts/123', { headers: h })).status).toBe(400);
    expect(web.validId('5f8d0d55b54764421b7156c9')).toBe(true);
    process.env.MONGODB_URI = 'mongodb://example.invalid/x';
    try { expect(web.validId('m3')).toBe(false); } finally { delete process.env.MONGODB_URI; }
  });

  test('error async en /api → 500 {error:"api"} sin colgar la request', async () => {
    const entitlements = require('../src/services/entitlements');
    const spy = jest.spyOn(entitlements, 'isPro').mockRejectedValue(new Error('db caída'));
    try {
      const res = await call(createApp(), 'GET', '/app/api/me', { headers: { 'X-Telegram-Init-Data': authFor({ id: 501 }) } });
      expect(res.status).toBe(500);
      expect(res.json).toEqual({ error: 'api' });
    } finally { spy.mockRestore(); }
  });

  test('directLink: t.me/<bot>/<short> solo con MINIAPP_SHORT_NAME válido', () => {
    expect(miniapp.directLink({ TELEGRAM_BOT_USERNAME: 'flightalertpro_bot', MINIAPP_SHORT_NAME: 'app' })).toBe('https://t.me/flightalertpro_bot/app');
    expect(miniapp.directLink({ TELEGRAM_BOT_USERNAME: 'flightalertpro_bot' })).toBeNull();
    expect(miniapp.directLink({ TELEGRAM_BOT_USERNAME: 'flightalertpro_bot', MINIAPP_SHORT_NAME: 'a/b' })).toBeNull();
  });
});
