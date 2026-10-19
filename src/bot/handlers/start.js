'use strict';

const { col } = require('../../database');
const copy = require('../copy');
const link = require('../../services/payments/link');
const sessions = require('../sessions');

function register(bot) {
  bot.onText(/^\/start(?:@\w+)?(?:\s+(\S+))?$/, async (msg, match) => {
    const arg = match && match[1] ? match[1] : '';
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (arg.startsWith('link_')) {
      const result = await link.consume(arg.slice('link_'.length), userId, chatId);
      await bot.sendMessage(chatId, result.ok
        ? 'Listo, vinculé este chat con tu pago.'
        : 'Ese código no sirve o ya venció.');
      return;
    }
    await col('User').updateOne(
      { telegramUserId: String(userId) },
      {
        $set: { telegramChatId: String(chatId) },
        $setOnInsert: { telegramUserId: String(userId), currency: 'EUR', alertMinLevel: 'good' },
      },
      { upsert: true },
    );
    await bot.sendMessage(chatId, copy.welcome(msg.from.first_name));
  });

  bot.onText(/^\/cancel(?:@\w+)?$/, async (msg) => {
    await sessions.clearSession(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'Listo, cancelé lo que estábamos haciendo.');
  });

  bot.onText(/^\/terms(?:@\w+)?$/, async (msg) => {
    await bot.sendMessage(msg.chat.id, copy.terms);
  });

  bot.onText(/^\/paysupport(?:@\w+)?$/, async (msg) => {
    await bot.sendMessage(msg.chat.id, copy.paysupport);
  });
}

module.exports = { register };
