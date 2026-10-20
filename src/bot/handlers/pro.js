'use strict';

const stars = require('../../services/payments/stars');

function register(bot) {
  bot.onText(/^\/pro(?:@\w+)?$/, async (msg) => {
    await stars.sendInvoice(bot, msg.chat.id, msg.from.id);
  });
}

module.exports = { register };
