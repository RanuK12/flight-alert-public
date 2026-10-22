'use strict';

const ai = require('../../services/ai');
const buscar = require('./buscar');
const logger = require('../../utils/logger').child('ai');

/** Tope de precio del texto del usuario (no del modelo): "baja de 900 euros", "menos de 900 €", "under 900 eur". */
function priceCeiling(text) {
  const m = /(?:baja(?:r)?\s+de|menos\s+de|por\s+debajo\s+de|debajo\s+de|below|under|less\s+than)\s*€?\s*(\d{1,3}(?:[.,]\d{3})+|\d{2,5})\s*(?:€|eur(?:os?)?)?/i.exec(String(text || ''));
  if (!m) return null;
  const n = Number(m[1].replace(/[.,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

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
    // Pro/admin con la IA caída o sin entender: lo decimos, no "no entendí" genérico.
    if (out.reason === 'providers_down' || out.reason === 'invalid') {
      logger.error('búsqueda IA falló', { reason: out.reason });
      const { t, langOf } = require('../ux/i18n');
      await bot.sendMessage(msg.chat.id, t(langOf(msg.from), 'aiFailed'));
      return true;
    }
    return false;
  }
  const v = out.value;
  await buscar.replySearch(bot, msg.chat.id, userId, {
    origin: v.origin,
    destination: v.destination,
    departureDate: v.departDate,
    returnDate: v.returnDate,
    adults: v.adults,
  });
  const price = priceCeiling(msg.text);
  if (price) {
    const { t, langOf } = require('../ux/i18n');
    const cb = require('../ux/cb');
    const lang = langOf(msg.from);
    const f = { o: v.origin, d: v.destination };
    await bot.sendMessage(msg.chat.id, t(lang, 'aiPriceOffer', { ...f, price }), {
      reply_markup: { inline_keyboard: [[{ text: t(lang, 'btnAiAlert', f), callback_data: cb.encode('o', 'al', f) }]] },
    });
  }
  return true;
}

module.exports = { handleText, priceCeiling };
