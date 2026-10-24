'use strict';

const flags = require('../config/flags');

/** Medios de pago prendidos, en un solo lugar para la landing y /pro. */
function enabled() {
  const out = [];
  if (flags.stripe()) out.push('stripe');
  if (flags.mp()) out.push('mp');
  if (flags.stars()) out.push('stars');
  return out;
}

const LABELS = {
  es: { stripe: 'Tarjeta (Stripe)', mp: 'Mercado Pago', stars: 'Estrellas de Telegram' },
  pt: { stripe: 'Cartão (Stripe)', mp: 'Mercado Pago', stars: 'Estrelas do Telegram' },
  en: { stripe: 'Card (Stripe)', mp: 'Mercado Pago', stars: 'Telegram Stars' },
};

function labels(lang) {
  const l = LABELS[LABELS[lang] ? lang : 'es'];
  return enabled().map((k) => l[k]);
}

function line(lang) {
  const list = labels(lang);
  if (!list.length) return { en: 'Payments are paused right now.', pt: 'Os pagamentos estão pausados no momento.' }[lang] || 'Los pagos están pausados por ahora.';
  return list.join(' · ');
}

module.exports = { enabled, labels, line };
