'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn().mockResolvedValue([]) }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const rateLimit = require('../src/services/rateLimit');
const runtimeFlags = require('../src/services/runtimeFlags');
const flags = require('../src/config/flags');
const admin = require('../src/bot/admin');

const ADMIN = '4242';
const USER = '5151';

function fakeBot() {
  const bot = { sent: [], handlers: [] };
  bot.onText = (re, fn) => bot.handlers.push([re, fn]);
  bot.sendMessage = async (chatId, text, opts) => { bot.sent.push({ chatId, text, opts }); };
  bot.answerCallbackQuery = async () => true;
  admin.register(bot);
  bot.cmd = async (from, text) => {
    for (const [re, fn] of bot.handlers) { const m = text.match(re); if (m) await fn({ chat: { id: from }, from: { id: from, language_code: 'es' }, text }, m); }
  };
  bot.tap = (from, data) => admin.onCallback(bot, { id: 'q', data, from: { id: from }, message: { chat: { id: from }, message_id: 1 } });
  return bot;
}
const buttons = (m) => ((m && m.opts && m.opts.reply_markup && m.opts.reply_markup.inline_keyboard) || []).flat();

beforeEach(() => {
  cleanEnv(); reset(); clock.reset(); rateLimit.reset(); runtimeFlags.reset(); admin.resetPending();
  process.env.ADMIN_TELEGRAM_IDS = ` ${ADMIN} , 999 `;
});
afterEach(() => { delete process.env.ADMIN_TELEGRAM_IDS; });

test('ADMIN_TELEGRAM_IDS se lee de la env', () => {
  expect(flags.isAdmin(ADMIN)).toBe(true);
  expect(flags.isAdmin(USER)).toBe(false);
  delete process.env.ADMIN_TELEGRAM_IDS;
  expect(flags.isAdmin(ADMIN)).toBe(false);
});

test('no admin: /admin da la respuesta normal de "no entendí" y no ve nada', async () => {
  const bot = fakeBot();
  const ux = require('../src/bot/ux');
  const normal = fakeBot();
  await ux.notUnderstood(normal, { chat: { id: USER }, from: { id: USER, language_code: 'es' } });
  await bot.cmd(USER, '/admin');
  await bot.cmd(USER, `/admin pro ${USER}`);
  expect(bot.sent).toHaveLength(2);
  for (const m of bot.sent) {
    expect(m.text).toBe(normal.sent[0].text);
    expect(buttons(m).some((b) => String(b.callback_data || '').startsWith('adm:'))).toBe(false);
  }
  expect(await bot.tap(USER, 'adm:status')).toBe(true);
  expect(bot.sent).toHaveLength(2);
  expect(await col('AdminAudit').countDocuments({})).toBe(0);
  const e = await col('Entitlement').findOne({ telegramUserId: USER });
  expect(e && e.plan).not.toBe('pro');
});

test('/admin no está en los comandos públicos', () => {
  const src = require('fs').readFileSync(require.resolve('../src/bot/miniapp'), 'utf8') + require('fs').readFileSync(require.resolve('../src/bot/ux'), 'utf8');
  expect(src).not.toMatch(/command:\s*['"]admin['"]/);
});

test('admin ve el menú y queda auditado', async () => {
  const bot = fakeBot();
  await bot.cmd(ADMIN, '/admin');
  const data = buttons(bot.sent[0]).map((b) => b.callback_data);
  expect(data).toEqual(expect.arrayContaining(['adm:status', 'adm:counts', 'adm:price', 'adm:logs', 'adm:ask:kill:on', 'adm:ia:on']));
  await bot.tap(ADMIN, 'adm:status');
  expect(bot.sent[1].text).toMatch(/webhook/);
  const rows = await col('AdminAudit').find({ adminId: ADMIN }).lean();
  expect(rows.map((r) => r.action)).toEqual(['menu', 'status']);
  expect(rows[0].at).toBeTruthy();
});

test('kill switch pide confirmación; sin confirmar no cambia', async () => {
  const bot = fakeBot();
  await bot.tap(ADMIN, 'adm:ask:kill:on');
  expect(flags.kill()).toBe(false);
  const ok = buttons(bot.sent[0]).find((b) => b.text.includes('Confirmar')).callback_data;
  // Otro usuario no puede confirmar
  await bot.tap(USER, ok);
  expect(flags.kill()).toBe(false);
  await bot.tap(ADMIN, ok);
  expect(flags.kill()).toBe(true);
  // El nonce no se reusa
  await bot.tap(ADMIN, 'adm:ask:kill:off');
  await bot.tap(ADMIN, ok);
  expect(flags.kill()).toBe(true);
  const done = await col('AdminAudit').find({ action: 'kill:on', status: 'done' }).lean();
  expect(done).toHaveLength(1);
});

test('dar y sacar Pro con confirmación, auditado y reversible', async () => {
  const bot = fakeBot();
  await bot.cmd(ADMIN, `/admin pro ${USER}`);
  expect(await require('../src/services/entitlements').isPro(USER)).toBe(false);
  const ok = buttons(bot.sent[0]).find((b) => b.text.includes('Confirmar')).callback_data;
  await bot.tap(ADMIN, ok);
  const e = await col('Entitlement').findOne({ telegramUserId: USER });
  expect(e.plan).toBe('pro');
  expect(e.source).toBe('comp');
  expect(await col('Payment').countDocuments({})).toBe(0);
  const audit = await col('AdminAudit').findOne({ action: 'grantPro', status: 'done' });
  expect(audit).toMatchObject({ adminId: ADMIN, target: USER });

  await bot.cmd(ADMIN, `/admin unpro ${USER}`);
  const ok2 = buttons(bot.sent[bot.sent.length - 1]).find((b) => b.text.includes('Confirmar')).callback_data;
  await bot.tap(ADMIN, ok2);
  expect((await col('Entitlement').findOne({ telegramUserId: USER })).plan).toBe('free');
});

test('cancelar no ejecuta y queda auditado', async () => {
  const bot = fakeBot();
  await bot.cmd(ADMIN, `/admin pro ${USER}`);
  const no = buttons(bot.sent[0]).find((b) => b.text.includes('Cancelar')).callback_data;
  await bot.tap(ADMIN, no);
  expect(await col('Entitlement').findOne({ telegramUserId: USER })).toBeFalsy();
  expect(await col('AdminAudit').findOne({ action: 'grantPro', status: 'cancelled' })).toBeTruthy();
});

test('logs redactados', async () => {
  require('../src/utils/logger').child('t').info('x Bearer abcdefghijklmnop sk_test_ABCDEFGHIJKL');
  const bot = fakeBot();
  await bot.tap(ADMIN, 'adm:logs');
  const text = bot.sent[0].text;
  expect(text).not.toMatch(/abcdefghijklmnop|sk_test_ABCDEFGHIJKL/);
});

test('admin = Pro sin límites, con tope anti-loop alto', async () => {
  const ent = require('../src/services/entitlements');
  expect(await ent.isPro(ADMIN)).toBe(true);
  expect(await ent.canUseAlerts(ADMIN)).toBe(true);
  expect(ent.proCaps(ADMIN).perDay).toBe(500);
  expect(ent.proCaps(USER).perDay).toBe(60);
});

test('admins no cuentan en métricas ni pagos', async () => {
  const now = clock.now().toISOString();
  await col('Entitlement').create({ telegramUserId: ADMIN, plan: 'pro', proUntil: '2099-01-01T00:00:00.000Z', searchesUsed: 0 });
  await col('Entitlement').create({ telegramUserId: USER, plan: 'free', searchesUsed: 0 });
  await col('Payment').create({ provider: 'stripe', ref: 'a', telegramUserId: ADMIN, status: 'paid', paidAt: now });
  await col('Payment').create({ provider: 'stripe', ref: 'b', telegramUserId: USER, status: 'paid', paidAt: now });
  const c = await require('../src/web/admin').counts();
  expect(c.users).toMatchObject({ total: 1, pro: 0, free: 1 });
  expect(c.paymentsToday.stripe).toBe(1);
});

test('admin: botón 📊 Visitas muestra el resumen', async () => {
  const bot = fakeBot();
  await bot.cmd(ADMIN, '/admin');
  expect(buttons(bot.sent[0]).some((b) => b.callback_data === 'adm:visits')).toBe(true);
  await bot.tap(ADMIN, 'adm:visits');
  expect(bot.sent[bot.sent.length - 1].text).toContain('📊 Visitas');
  await bot.tap(ADMIN, 'adm:counts');
  expect(bot.sent[bot.sent.length - 1].text).toContain('Visitas hoy:');
});
