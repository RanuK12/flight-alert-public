'use strict';

const ai = require('../../services/ai');
const { replySearch } = require('./buscar');

/** Texto libre → búsqueda. Devuelve true si lo consumió. */
async function handleText(bot, msg) {
  const userId = msg.from && msg.from.id;
  const out = await ai.parse(userId, msg.text);
  if (!out.ok) {
    if (out.reason === 'daily_cap') {
      await bot.sendMessage(msg.chat.id, 'Llegaste al tope diario de búsquedas con IA. Probá con /buscar EZE MAD AAAA-MM-DD.');
      return true;
    }
    if (out.reason === 'not_pro') {
      const { t, langOf } = require('../ux/i18n');
      const cb = require('../ux/cb');
      const lang = langOf(msg.from);
      await bot.sendMessage(msg.chat.id, t(lang, 'aiUpsell'), {
        reply_markup: { inline_keyboard: [[{ text: t(lang, 'btnPro'), callback_data: cb.encode('p', 'show') }]] },
      });
      return true;
    }
    return false;
  }
  const v = out.value;
  await replySearch(bot, msg.chat.id, userId, {
    origin: v.origin,
    destination: v.destination,
    departureDate: v.departDate,
    returnDate: v.returnDate,
    adults: v.adults,
  });
  return true;
}

module.exports = { handleText };
