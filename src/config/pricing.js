'use strict';

/** Precios y duración base de Pro. Una sola fuente para la web, el checkout y el bot. */
const PRO_EUR_CENTS = Number(process.env.PRO_EUR_CENTS || 450);
const PRO_USD_CENTS = Number(process.env.PRO_USD_CENTS || 500);
const PRO_STARS = Number(process.env.PRO_STARS || 250);
const PRO_DAYS = Number(process.env.PRO_DAYS || 30);

function proStars() {
  const v = Number(process.env.PRO_STARS);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : PRO_STARS;
}

function proDays() {
  const v = Number(process.env.PRO_DAYS);
  if (Number.isFinite(v) && v > 0) return Math.round(v);
  try {
    const cfg = require('./plans').current();
    if (cfg && cfg.pro && Number.isFinite(cfg.pro.days) && cfg.pro.days > 0) return cfg.pro.days;
  } catch { /* circular or unset */ }
  return PRO_DAYS;
}

function figure(cents, lang) {
  const n = (cents / 100).toFixed(2);
  return lang === 'en' ? n : n.replace('.', ',');
}

module.exports = {
  PRO_EUR_CENTS,
  PRO_USD_CENTS,
  PRO_STARS,
  PRO_DAYS,
  proStars,
  proDays,
  figure,
};
