'use strict';

const geoip = require('geoip-lite');
const pricing = require('../config/pricing');

/**
 * Orden: elección de la persona, IP real (geo del servidor), medio de pago.
 * El idioma solo preselecciona. ARS solo si la elección y la IP coinciden en AR.
 * €4,50 IVA incluido para toda la UE. USD 5 para el resto.
 */

const EU_COUNTRIES = [
  ['AT', 'Austria'],
  ['BE', 'Bélgica'],
  ['BG', 'Bulgaria'],
  ['HR', 'Croacia'],
  ['CY', 'Chipre'],
  ['CZ', 'Chequia'],
  ['DK', 'Dinamarca'],
  ['EE', 'Estonia'],
  ['FI', 'Finlandia'],
  ['FR', 'Francia'],
  ['DE', 'Alemania'],
  ['GR', 'Grecia'],
  ['HU', 'Hungría'],
  ['IE', 'Irlanda'],
  ['IT', 'Italia'],
  ['LV', 'Letonia'],
  ['LT', 'Lituania'],
  ['LU', 'Luxemburgo'],
  ['MT', 'Malta'],
  ['NL', 'Países Bajos'],
  ['PL', 'Polonia'],
  ['PT', 'Portugal'],
  ['RO', 'Rumania'],
  ['SK', 'Eslovaquia'],
  ['SI', 'Eslovenia'],
  ['ES', 'España'],
  ['SE', 'Suecia'],
];

const EU = new Set(EU_COUNTRIES.map(([code]) => code));

function rail({ choice, ipCountry, paidWith } = {}) {
  if (String(paidWith || '').toLowerCase() === 'mp') return 'mp';
  const selected = String(choice || '').toUpperCase();
  const ip = String(ipCountry || '').toUpperCase();
  if (selected === 'AR' && ip === 'AR') return 'mp';
  return 'stripe';
}

function currencyFor(choice, ipCountry) {
  const selected = String(choice || '').toUpperCase();
  const ip = String(ipCountry || '').toUpperCase();
  if (selected === 'AR' && ip === 'AR') {
    return { rail: 'mp', currency: 'ARS', unitAmount: null };
  }
  if (EU.has(selected)) {
    return { rail: 'stripe', currency: 'EUR', unitAmount: pricing.PRO_EUR_CENTS };
  }
  if (selected && selected !== 'AR' && selected !== 'OTRO') {
    return { rail: 'stripe', currency: 'USD', unitAmount: pricing.PRO_USD_CENTS };
  }
  if (EU.has(ip)) {
    return { rail: 'stripe', currency: 'EUR', unitAmount: pricing.PRO_EUR_CENTS };
  }
  return { rail: 'stripe', currency: 'USD', unitAmount: pricing.PRO_USD_CENTS };
}

function preselect(languageCode) {
  const code = String(languageCode || '').toLowerCase();
  if (code.startsWith('es')) return 'AR';
  return '';
}

function isLocal(ip) {
  const raw = String(ip || '').replace(/^::ffff:/, '');
  if (!raw || raw === '::1' || raw === '127.0.0.1' || raw === 'local') return true;
  if (raw.startsWith('10.') || raw.startsWith('192.168.') || raw.startsWith('172.')) return true;
  return false;
}

function defaultLookup(ip) {
  if (isLocal(ip)) return '';
  const raw = String(ip || '').replace(/^::ffff:/, '');
  const hit = geoip.lookup(raw);
  return String((hit && hit.country) || '').toUpperCase();
}

let lookup = defaultLookup;

function setLookup(fn) {
  lookup = fn || defaultLookup;
}

function resetLookup() {
  lookup = defaultLookup;
}

/**
 * País de la IP de Express (trust proxy). No lee headers que manda el cliente.
 * @param {import('express').Request} req
 */
async function ipCountry(req) {
  const ip = req && req.ip ? req.ip : '';
  try {
    return await lookup(ip);
  } catch {
    return '';
  }
}

module.exports = {
  EU,
  EU_COUNTRIES,
  rail,
  currencyFor,
  preselect,
  ipCountry,
  setLookup,
  resetLookup,
  isLocal,
};
