'use strict';

jest.mock('../src/services/dailyReport', () => ({
  sendSummaryForUser: jest.fn().mockResolvedValue({ pdf: true, count: 1 }),
  runDailyDigest: jest.fn(),
}));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true), sendDocument: jest.fn().mockResolvedValue(true) }));

const { cleanEnv } = require('./helpers');
const { reset, col } = require('../src/database');
const clock = require('../src/utils/clock');
const daily = require('../src/services/dailyReport');
const entitlements = require('../src/services/entitlements');
const ux = require('../src/bot/ux');
const miniapp = require('../src/bot/miniapp');
const cb = require('../src/bot/ux/cb');

function fakeBot() {
  const bot = { sent: [] };
  bot.sendMessage = jest.fn(async (chatId, text, extra) => { bot.sent.push({ chatId, text, extra }); return { message_id: bot.sent.length }; });
  bot.answerCallbackQuery = jest.fn().mockResolvedValue(true);
  return bot;
}
const msg = (id, lang = 'es') => ({ chat: { id }, from: { id, language_code: lang }, text: '/informe' });

async function pro(id) {
  await col('Entitlement').create({ telegramUserId: String(id), plan: 'pro', proUntil: '2099-01-01T00:00:00.000Z', searchesUsed: 0 });
  await col('Route').create({ telegramUserId: String(id), origin: 'COR', destination: 'MAD', tripType: 'oneway', paused: false });
}

beforeEach(() => {
  cleanEnv(); reset(); jest.clearAllMocks();
  clock.setNow('2026-10-24T15:00:00.000Z'); // 12:00 ART
});
afterEach(() => clock.reset());

test('Pro sin informe previo: /informe arma el informe al momento (sin esperar a las 21)', async () => {
  await pro(10);
  const bot = fakeBot();
  const out = await ux.report(bot, msg(10));
  expect(out.onDemand).toBe(true);
  expect(daily.sendSummaryForUser).toHaveBeenCalledWith(bot, 10, 10);
  expect(bot.sent.map((s) => s.text).join('\n')).not.toMatch(/21:00 \(hora de Argentina, UTC-3\)/);
  const doc = await col('Entitlement').findOne({ telegramUserId: '10' });
  expect(doc.reportsToday).toBe(1);
  expect(doc.reportDay).toBe('2026-10-24');
});

test('tope de 2 por día ART; el tercero avisa cuándo se renueva; al otro día ART vuelve', async () => {
  await pro(11);
  const bot = fakeBot();
  await ux.report(bot, msg(11));
  await ux.report(bot, msg(11));
  const third = await ux.report(bot, msg(11));
  expect(third.limited).toBe(true);
  expect(daily.sendSummaryForUser).toHaveBeenCalledTimes(2);
  expect(bot.sent.at(-1).text).toBe('Ya pediste tus 2 informes de hoy. Se renuevan a las 00:00 (hora de Argentina). El de las 21:00 te llega igual.');
  // 23:59 ART sigue siendo el mismo día
  clock.setNow('2026-10-25T02:59:00.000Z');
  expect((await ux.report(bot, msg(11))).limited).toBe(true);
  // 00:01 ART del 25: se renueva
  clock.setNow('2026-10-25T03:01:00.000Z');
  expect((await ux.report(bot, msg(11))).onDemand).toBe(true);
});

test('concurrentes no pasan el tope', async () => {
  await col('Entitlement').create({ telegramUserId: '12', plan: 'pro', proUntil: '2099-01-01T00:00:00.000Z' });
  const r = await Promise.all(Array.from({ length: 6 }, () => entitlements.reserveOnDemandReport(12)));
  expect(r.filter(Boolean)).toHaveLength(2);
});

test('si el envío falla no se descuenta', async () => {
  await pro(13);
  daily.sendSummaryForUser.mockRejectedValueOnce(new Error('boom'));
  const bot = fakeBot();
  expect((await ux.report(bot, msg(13))).failed).toBe(true);
  const doc = await col('Entitlement').findOne({ telegramUserId: '13' });
  expect(doc.reportsToday).toBe(0);
});

test('Pro sin alertas activas: no descuenta y ofrece crear una', async () => {
  await col('Entitlement').create({ telegramUserId: '14', plan: 'pro', proUntil: '2099-01-01T00:00:00.000Z' });
  const bot = fakeBot();
  expect((await ux.report(bot, msg(14))).empty).toBe(true);
  expect(daily.sendSummaryForUser).not.toHaveBeenCalled();
});

test('no Pro: sigue como antes (sin informe a pedido)', async () => {
  await col('Route').create({ telegramUserId: '15', origin: 'COR', destination: 'MAD', tripType: 'oneway', paused: false });
  const bot = fakeBot();
  const out = await ux.report(bot, msg(15));
  expect(out.empty).toBe(true);
  expect(daily.sendSummaryForUser).not.toHaveBeenCalled();
  expect(bot.sent[0].text).toMatch(/Todavía no hay informe/);
});

test('botón 📊 Informe del teclado y del panel inline corren el mismo handler', async () => {
  await pro(16);
  const bot = fakeBot();
  expect(miniapp.actionFor('📊 Informe')).toBe('report');
  expect(miniapp.actionFor('📊 Report')).toBe('report');
  expect(miniapp.actionFor('📊 Relatório')).toBe('report');
  expect(await ux.onKeyboard(bot, { ...msg(16), text: '📊 Informe' })).toBe('report');
  const inline = miniapp.homeInline('es', cb.encode).inline_keyboard.flat().find((b) => b.text === '📊 Informe');
  await ux.onCallback(bot, { id: 'q', data: inline.callback_data, from: { id: 16, language_code: 'es' }, message: { chat: { id: 16 }, message_id: 1 } });
  expect(daily.sendSummaryForUser).toHaveBeenCalledTimes(2);
});

test('setMyCommands incluye /informe en es/en/pt', () => {
  const c = miniapp.commands();
  expect(c.es.find((x) => x.command === 'informe').description).toBe('Tu informe de precios');
  expect(c.en.find((x) => x.command === 'informe').description).toBe('Your price report');
  expect(c.pt.find((x) => x.command === 'informe').description).toBe('Seu relatório de preços');
});
