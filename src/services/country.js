'use strict';

/**
 * Orden: elección de la persona, IP de la web, medio de pago, idioma solo para preseleccionar.
 * ARS solo si la elección y la IP coinciden en AR, o si paga con Mercado Pago Argentina.
 */
function rail({ choice, ipCountry, paidWith } = {}) {
  if (String(paidWith || '').toLowerCase() === 'mp') return 'mp';
  const selected = String(choice || '').toUpperCase();
  const ip = String(ipCountry || '').toUpperCase();
  if (selected === 'AR' && ip === 'AR') return 'mp';
  return 'stripe';
}

function preselect(languageCode) {
  const code = String(languageCode || '').toLowerCase();
  if (code.startsWith('es')) return 'AR';
  return '';
}

function ipCountry(req) {
  const raw = req.headers['cf-ipcountry'] || req.headers['x-geo-country'] || '';
  return String(raw).toUpperCase();
}

module.exports = { rail, preselect, ipCountry };
