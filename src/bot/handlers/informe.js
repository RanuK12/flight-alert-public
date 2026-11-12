'use strict';

const { col } = require('../../database');
const plans = require('../../config/plans');
const entitlements = require('../../services/entitlements');
const { sendSummaryForUser } = require('../../services/dailyReport');
const notifier = require('../notifier');
const { t } = require('../ux/i18n');

async function resolveLang(userId) {
  const u = await col('User').findOne({ telegramUserId: String(userId) }).lean();
  return (u && ['es', 'en', 'pt'].includes(u.lang) && u.lang) || 'es';
}

async function sendInforme(bot, chatId, userId) {
  if (!(await entitlements.canUseAlerts(userId))) {
    const lang = await resolveLang(userId);
    if (plans.isSafeMode()) {
      await notifier.send(bot, chatId, t(lang, 'planConfigDown'));
      return { chats: [String(chatId)] };
    }
    const trial = await entitlements.startTrial(userId);
    if (!trial.ok) {
      await notifier.send(bot, chatId, t(lang, 'capReached', { n: entitlements.maxAlertsFor('free') }));
      return { chats: [String(chatId)] };
    }
    const instant = plans.current().trial?.instantTotalMax ?? plans.INSTANT_ALERTS_TRIAL_MAX_TOTAL ?? 3;
    await notifier.send(bot, chatId, t(lang, 'trialOn', {
      days: entitlements.TRIAL_DAYS,
      instant,
      maxAlerts: entitlements.maxAlertsFor('trial'),
    }));
  }
  await col('Entitlement').updateOne(
    { telegramUserId: String(userId) },
    { $set: { telegramChatId: String(chatId) } },
    { upsert: true },
  );
  return sendSummaryForUser(bot, userId, chatId);
}

function register(bot) {
  bot.onText(/^\/informe(?:@\w+)?$/, async (msg) => {
    await sendInforme(bot, msg.chat.id, msg.from.id);
  });
}

module.exports = { register, sendInforme };
