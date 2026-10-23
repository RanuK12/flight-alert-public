'use strict';

/**
 * Duffel como fuente en tiempo real (solo lectura).
 * - Apagado si falta DUFFEL_ACCESS_TOKEN.
 * - Solo crea offer requests (cotizaciones). Nunca órdenes, pagos ni holds: el único endpoint es OFFER_PATH.
 * - Cache por ruta+fecha (DUFFEL_CACHE_MIN, 30 min) y tope local por minuto (DUFFEL_MAX_PER_MIN, 8; Duffel da 10).
 * - Cualquier error, timeout, tope o moneda sin tipo de cambio → null (fallback silencioso a Travelpayouts).
 */

const axios = require('axios');
const clock = require('../utils/clock');
const logger = require('../utils/logger').child('duffel');

const BASE = 'https://api.duffel.com';
const OFFER_PATH = '/air/offer_requests';
const FX_URL = 'https://api.frankfurter.app/latest';

const cache = new Map();
const fxCache = new Map();
let calls = [];
let blockedUntil = 0;
let skipped = false;
let tickCalls = null; // null = fuera de un tick de alertas (búsquedas del usuario no usan este tope)

/** En producción un token de prueba (duffel_test_…) se rechaza: solo devuelve la aerolínea ficticia. */
function testTokenInProd() {
  const t = process.env.DUFFEL_ACCESS_TOKEN || '';
  return process.env.NODE_ENV === 'production' && t.startsWith('duffel_test_');
}
function enabled() {
  return Boolean(process.env.DUFFEL_ACCESS_TOKEN) && !testTokenInProd();
}
/** Ofertas de prueba de Duffel ("Duffel Airways", IATA ZZ): nunca cuentan como precio real. */
function isTestOffer(o) {
  const owner = (o && o.owner) || {};
  return /duffel airways/i.test(String(owner.name || '')) || String(owner.iata_code || '').toUpperCase() === 'ZZ';
}
/** Vuelta (tick) de alertas: tope DUFFEL_MAX_PER_TICK (por defecto 20) llamadas por vuelta. */
function beginTick() { tickCalls = 0; }
function endTick() { tickCalls = null; }
const num = (k, d) => (Number.isFinite(Number(process.env[k])) && process.env[k] !== '' ? Number(process.env[k]) : d);

function reset() {
  cache.clear();
  fxCache.clear();
  calls = [];
  blockedUntil = 0;
  tickCalls = null;
}

function takeSlot(now) {
  if (now < blockedUntil) return false;
  calls = calls.filter((t) => now - t < 60000);
  if (calls.length >= num('DUFFEL_MAX_PER_MIN', 8)) return false;
  calls.push(now);
  return true;
}

async function toEur(amount, currency) {
  const cur = String(currency || '').toUpperCase();
  if (cur === 'EUR') return amount;
  const now = clock.now().getTime();
  const hit = fxCache.get(cur);
  let rate = hit && now - hit.at < 12 * 3600000 ? hit.rate : null;
  if (!rate) {
    const res = await axios.get(FX_URL, { params: { from: cur, to: 'EUR' }, timeout: 5000 });
    rate = Number(res.data && res.data.rates && res.data.rates.EUR);
    if (!(rate > 0)) throw new Error(`sin tipo de cambio ${cur}`);
    fxCache.set(cur, { rate, at: now });
  }
  return amount * rate;
}

function mapOffer(o, q, eur, now) {
  const out = (o.slices || [])[0] || {};
  const back = (o.slices || [])[1];
  const segs = out.segments || [];
  const dur = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(String(out.duration || ''));
  const durationMin = dur ? (Number(dur[1] || 0) * 1440 + Number(dur[2] || 0) * 60 + Number(dur[3] || 0)) || null : null;
  return {
    origin: q.origin,
    destination: q.destination,
    departureDate: q.departureDate,
    returnDate: back ? q.returnDate : null,
    price: Math.round(eur),
    currency: 'EUR',
    stops: Math.max(0, segs.length - 1),
    durationMin,
    foundAt: now.toISOString(),
    actual: true,
    gate: (o.owner && o.owner.iata_code) || null,
    source: 'duffel',
  };
}

/**
 * Oferta más barata (en EUR) para origen/destino/fecha exactos, o null.
 * q: { origin, destination, departureDate, returnDate|null }
 */
async function cheapest(q) {
  if (!enabled() || !q || !q.departureDate) return null;
  const key = [q.origin, q.destination, q.departureDate, q.returnDate || ''].join('|');
  const now = clock.now();
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < num('DUFFEL_CACHE_MIN', 30) * 60000) return hit.value;
  skipped = false;
  if (tickCalls !== null && tickCalls >= num('DUFFEL_MAX_PER_TICK', 20)) { skipped = true; return null; }
  if (!takeSlot(now.getTime())) { skipped = true; return null; }
  if (tickCalls !== null) tickCalls += 1;
  try {
    const slices = [{ origin: q.origin, destination: q.destination, departure_date: q.departureDate }];
    if (q.returnDate) slices.push({ origin: q.destination, destination: q.origin, departure_date: q.returnDate });
    const res = await axios.post(`${BASE}${OFFER_PATH}`, { data: { slices, passengers: [{ type: 'adult' }], cabin_class: 'economy' } }, {
      params: { return_offers: true, supplier_timeout: 15000 },
      headers: { Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: num('DUFFEL_TIMEOUT_MS', 25000),
    });
    const offers = ((res.data && res.data.data && res.data.data.offers) || [])
      .filter((o) => Number(o.total_amount) > 0 && !isTestOffer(o))
      .sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
    let value = null;
    if (offers.length) {
      const best = offers[0];
      value = mapOffer(best, q, await toEur(Number(best.total_amount), best.total_currency), now);
    }
    cache.set(key, { at: now.getTime(), value });
    return value;
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 429) { blockedUntil = now.getTime() + 60000; skipped = true; }
    logger.warn('duffel no respondió', { status: status || null, error: err.message });
    return null;
  }
}

function lastSkipped() { return skipped; }

module.exports = { lastSkipped, enabled, isTestOffer, beginTick, endTick, cheapest, reset, OFFER_PATH, BASE };
