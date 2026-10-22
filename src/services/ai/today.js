'use strict';

const clock = require('../../utils/clock');

const TZ = 'America/Argentina/Cordoba';
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Fecha de hoy (YYYY-MM-DD) en America/Argentina/Cordoba. Única fuente de "hoy" para la IA. */
function todayART(date = clock.now()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

module.exports = { todayART, TZ };
