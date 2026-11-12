'use strict';

const { col } = require('../../database');
const copy = require('../copy');
const flags = require('../../config/flags');
const entitlements = require('../../services/entitlements');
const link = require('../../services/payments/link');
const sessions = require('../sessions');
const ux = require('../ux');
const { t, langOf } = require('../ux/i18n');

const logger = require('../../utils/logger').child('start');

async function resolveLang(userId, from) {
  if (from && from.language_code) return langOf(from);
  const u = userId ? await col('User').findOne({ telegramUserId: String(userId) }).lean() : null;
  if (u && ['es', 'en', 'pt'].includes(u.lang)) return u.lang;
  return langOf(from);
}

/** Payload del deep link para atribución de campañas. Sin PII: solo el id y el payload saneado. */
function startParam(arg) {
  const v = String(arg || '');
  if (!v || v.startsWith('link_')) return null; // link_ es un código de un solo uso, no campaña
  return v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;
}

function attribution(userId, arg) {
  const param = startParam(arg);
  if (!param) return;
  logger.info('start_param', { telegramUserId: String(userId), startParam: param });
  Promise.resolve()
    .then(() => col('StartEvent').create({ telegramUserId: String(userId), startParam: param, at: new Date() }))
    .catch(() => {});
}

function register(bot) {
  bot.onText(/^\/start(?:@\w+)?(?:\s+(\S+))?$/, async (msg, match) => {
    const arg = match && match[1] ? match[1] : '';
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    attribution(userId, arg);
    if (arg.startsWith('link_')) {
      const result = await link.consume(arg.slice('link_'.length), userId, chatId);
      await bot.sendMessage(chatId, result.ok
        ? 'Listo, vinculé este chat con tu pago.'
        : 'Ese código no sirve o ya venció.');
      return;
    }
    const existing = await col('User').findOne({ telegramUserId: String(userId) });
    await col('User').updateOne(
      { telegramUserId: String(userId) },
      {
        $set: { telegramChatId: String(chatId), lang: langOf(msg.from), firstName: msg.from.first_name ? String(msg.from.first_name).slice(0, 64) : null },
        $setOnInsert: { telegramUserId: String(userId), currency: 'EUR', alertMinLevel: 'good' },
      },
      { upsert: true },
    );
    await ux.welcome(bot, msg, { isNew: !existing, startParam: startParam(arg) });
  });

  bot.onText(/^\/cancel(?:@\w+)?$/, async (msg) => {
    await sessions.clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'Listo, cancelé lo que estábamos haciendo.');
  });

  bot.onText(/^\/terms(?:@\w+)?$/, async (msg) => {
    const lang = await resolveLang(msg.from && msg.from.id, msg.from);
    await bot.sendMessage(msg.chat.id, t(lang, 'termsText', { proDays: entitlements.PRO_DAYS }));
  });

  bot.onText(/^\/paysupport(?:@\w+)?$/, async (msg) => {
    if (!flags.stars()) return;
    const lang = await resolveLang(msg.from && msg.from.id, msg.from);
    await bot.sendMessage(msg.chat.id, t(lang, 'paysupportText', { contact: process.env.SUPPORT_CONTACT || '' }));
  });
}

module.exports = { startParam, attribution, register };
