'use strict';

/** Argentina (Córdoba/Buenos Aires) es UTC-3 fijo, sin horario de verano. */
const OFFSET_MS = -3 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function parts(date) {
  const d = new Date(date.getTime() + OFFSET_MS);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), min: d.getUTCMinutes(),
    day: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
  };
}

/** Instante UTC de hoy (fecha ART) a la hora ART dada. */
function atArtHour(date, hour) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return new Date(midnight + hour * HOUR_MS - OFFSET_MS);
}

function startOfArtDay(date) {
  return atArtHour(date, 0);
}

function isQuiet(date, from = 0, to = 8) {
  const { h } = parts(date);
  return h >= from && h < to;
}

module.exports = { parts, atArtHour, startOfArtDay, isQuiet, HOUR_MS, DAY_MS, OFFSET_MS };
