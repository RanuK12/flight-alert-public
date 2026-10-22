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
    return false;
  }
  const v = out.value;
  await replySearch(bot, msg.chat.id, userId, {
    origin: v.origin,
    destination: v.destination,
    departureDate: v.departDate,
    returnDate: v.returnDate,
  });
  return true;
}

module.exports = { handleText };
