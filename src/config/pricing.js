'use strict';

/** Precios de Pro por 30 días. Una sola fuente para la web, el checkout y el bot. */
const PRO_EUR_CENTS = Number(process.env.PRO_EUR_CENTS || 450);
const PRO_USD_CENTS = Number(process.env.PRO_USD_CENTS || 500);
const PRO_STARS = 250;

function figure(cents, lang) {
  const n = (cents / 100).toFixed(2);
  return lang === 'en' ? n : n.replace('.', ',');
}

module.exports = { PRO_EUR_CENTS, PRO_USD_CENTS, PRO_STARS, figure };
