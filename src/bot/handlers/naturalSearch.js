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

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Parámetros de búsqueda a partir de lo validado. Con flex_dias > 0 se busca en la ventana
 * [ida - flex, ida + flex] (sin bajar de hoy ART); la vuelta conserva las noches del pedido.
 */
function queryFrom(v, today = ai.today()) {
  const base = {
    origin: v.origin,
    destination: v.destination,
    departureDate: v.departDate,
    returnDate: v.returnDate,
    adults: v.adults,
  };
  const flex = Number(v.flexDays) || 0;
  if (!flex) return base;
  const from = addDays(v.departDate, -flex) < today ? today : addDays(v.departDate, -flex);
  const to = addDays(v.departDate, flex);
  const months = [...new Set([from, to].map((d) => d.slice(0, 7)))];
  const q = { origin: v.origin, destination: v.destination, adults: v.adults, months, from, to };
  if (v.returnDate) {
    q.oneway = false;
    q.stay = Math.round((new Date(`${v.returnDate}T00:00:00Z`) - new Date(`${v.departDate}T00:00:00Z`)) / 86400000) || null;
  } else {
    q.oneway = true;
  }
  return q;
}

/** Texto libre → búsqueda. Devuelve true si lo consumió. */
async function handleText(bot, msg) {
  const userId = msg.from && msg.from.id;
  const out = await ai.parse(userId, msg.text);
  if (!out.ok) {
    // Tope diario de la IA: se vuelve al menú de siempre (y la ayuda P3 tampoco insiste).
    if (out.reason === 'daily_cap') {
      msg.aiCapped = true;
      return false;
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
    // El modelo entendió un pedido de vuelo pero falta algo o no cierra: se le vuelve a preguntar.
    if (out.reason === 'incomplete') {
      const { t, langOf } = require('../ux/i18n');
      await bot.sendMessage(msg.chat.id, t(langOf(msg.from), 'aiReask'));
      return true;
    }
    // Proveedores caídos, IA apagada o texto que no es una búsqueda: sigue el menú de siempre (o la ayuda P3).
    if (out.reason === 'providers_down') logger.warn('búsqueda IA sin respuesta', { reason: out.reason });
    return false;
  }
  const v = out.value;
  await buscar.replySearch(bot, msg.chat.id, userId, queryFrom(v));
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

module.exports = { handleText, priceCeiling, queryFrom };
