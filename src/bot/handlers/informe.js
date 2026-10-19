'use strict';

const { col } = require('../../database');
const entitlements = require('../../services/entitlements');
const { sendSummaryForUser } = require('../../services/dailyReport');
const copy = require('../copy');
const notifier = require('../notifier');

async function sendInforme(bot, chatId, userId) {
  if (!(await entitlements.canUseAlerts(userId))) {
    const trial = await entitlements.startTrial(userId);
    if (!trial.ok) {
      await notifier.send(bot, chatId, copy.alertsPaywall);
      return { chats: [String(chatId)] };
    }
    await notifier.send(bot, chatId, copy.trialOn);
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
