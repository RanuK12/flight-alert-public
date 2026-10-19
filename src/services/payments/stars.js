'use strict';

const crypto = require('crypto');
const flags = require('../../config/flags');
const { col } = require('../../database');
const entitlements = require('../entitlements');
const copy = require('../../bot/copy');

async function sendInvoice(bot, chatId, userId) {
  if (!flags.stars()) {
    await bot.sendMessage(chatId, copy.starsOff);
    return;
  }
  const payload = crypto.randomBytes(8).toString('hex');
  const link = await bot.createInvoiceLink(
    'Vuelos Pro',
    '30 días de búsquedas, alertas e informe diario.',
    payload,
    '',
    'XTR',
    [{ label: 'Pro 30 días', amount: 250 }],
    { subscription_period: 2592000 },
  );
  await bot.sendMessage(chatId, `Pro por 30 días: 250 estrellas.\n${link}`);
}

async function onSuccess(msg) {
  const pay = msg.successful_payment;
  if (!pay || !pay.telegram_payment_charge_id) return { ok: false };
  const result = await entitlements.activatePro(
    msg.from.id,
    'stars',
    String(pay.telegram_payment_charge_id),
    entitlements.proUntilFromNow(),
  );
  await col('Entitlement').updateOne(
    { telegramUserId: String(msg.from.id) },
    { $set: { telegramChatId: String(msg.chat.id), priceCurrency: 'XTR' } },
  );
  return result;
}

module.exports = { sendInvoice, onSuccess };
