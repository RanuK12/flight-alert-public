'use strict';

const { t } = require('./i18n');
const cal = require('./calendar');
const { bookingUrl } = require('../deepLinks');
const { ageMs } = require('../../services/sortFlights');

const HOUR = 3600 * 1000;
const WEEK = 7 * 24 * HOUR;

function seen(lang, foundAt, now) {
  const age = ageMs(foundAt, now);
  if (age < HOUR) return t(lang, 'seenLt1');
  if (age < 24 * HOUR) return t(lang, 'seenH', { n: Math.floor(age / HOUR) });
  return t(lang, 'seenD', { n: Math.floor(age / (24 * HOUR)) });
}

function money(price, currency) {
  return currency === 'EUR' || !currency ? `€ ${price}` : `${currency} ${price}`;
}

function dm(lang, iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${t(lang, 'monthsShort')[m - 1].toLowerCase()}`;
}

/** Hasta 5 resultados, por precio; >7 días no se muestra. Moneda: la que devuelve Travelpayouts (EUR). */
function render(lang, flights, now) {
  const fresh = flights.filter((x) => ageMs(x.foundAt, now) <= WEEK).sort((a, b) => a.price - b.price).slice(0, 5);
  const blocks = fresh.map((x) => [
    `💸 ${money(x.price, x.currency)} · ${x.returnDate ? t(lang, 'roundtripShort').toLowerCase() : t(lang, 'onewayShort').toLowerCase()}`,
    `${x.origin} → ${x.destination} · ${dm(lang, x.departureDate)}${x.returnDate ? ` → ${dm(lang, x.returnDate)}` : ''}`,
    `${x.stops === 0 ? t(lang, 'stops0') : t(lang, 'stopsN', { n: x.stops })} · ${seen(lang, x.foundAt, now)}`,
  ].join('\n'));
  const buttons = fresh.map((x, i) => [{ text: `${i + 1}. ${t(lang, 'seeWeb')}`, url: bookingUrl(x) }]);
  return { shown: fresh, text: `${blocks.join('\n\n')}\n\n${t(lang, 'footer')}`, buttons };
}

module.exports = { render, seen, cal };
