'use strict';

const axios = require('axios');
const logger = require('../utils/logger').child('travelpayouts');
const { pairAllowed } = require('../config/coverage');
const { isFresh } = require('../services/sortFlights');
const clock = require('../utils/clock');
const samplePrice = require('../services/samplePrice');
const duffel = require('./duffel');

/** Relleno en tiempo real cuando Travelpayouts no tiene precio fresco para una fecha exacta. */
async function fill(q) {
  if (!duffel.enabled()) return [];
  const row = await duffel.cheapest(q);
  return row ? [row] : [];
}

const BASE = 'https://api.travelpayouts.com';
// La misma moneda y el mismo mercado van en el link (src/bot/deepLinks.js).
const CURRENCY = 'eur';
function market() {
  return String(process.env.TRAVELPAYOUTS_MARKET || '').trim().toLowerCase();
}

function enabled() {
  return Boolean(process.env.TRAVELPAYOUTS_TOKEN);
}

async function get(path, params) {
  if (!enabled()) return [];
  const res = await axios.get(`${BASE}${path}`, {
    params: {
      ...params,
      token: process.env.TRAVELPAYOUTS_TOKEN,
      currency: CURRENCY,
      ...(market() ? { market: market() } : {}),
    },
    timeout: 8000,
    headers: { 'X-Access-Token': process.env.TRAVELPAYOUTS_TOKEN },
  });
  const data = res.data && (res.data.data || res.data);
  return { rows: Array.isArray(data) ? data : [], headers: res.headers || {} };
}

function mapRow(row) {
  const duration = Number(row.duration);
  return {
    origin: row.origin,
    destination: row.destination,
    departureDate: row.depart_date,
    returnDate: row.return_date || null,
    price: Math.round(Number(row.value)),
    currency: 'EUR',
    stops: Number(row.number_of_changes ?? 0),
    durationMin: Number.isFinite(duration) ? duration : null,
    foundAt: row.found_at || row.foundAt || null,
    actual: row.actual !== false,
    gate: row.gate || null,
  };
}

async function search(query) {
  const origin = String(query.origin || '').toUpperCase();
  const destination = String(query.destination || '').toUpperCase();
  if (!pairAllowed(origin, destination)) return [];
  const exact = { origin, destination, departureDate: query.departureDate, returnDate: query.returnDate || null };
  if (!enabled()) return fill(exact);
  const month = `${String(query.departureDate).slice(0, 7)}-01`;
  let payload;
  try {
    payload = await get('/v2/prices/month-matrix', { origin, destination, month });
  } catch (err) {
    logger.warn('travelpayouts no respondió', { error: err.message });
    return fill(exact);
  }
  const now = clock.now();
  const rows = payload.rows
    .map(mapRow)
    .filter((row) => row.actual && Number.isFinite(row.price) && row.price > 0)
    .filter((row) => row.departureDate === query.departureDate)
    .filter((row) => (query.returnDate ? row.returnDate === query.returnDate : !row.returnDate))
    .filter((row) => isFresh(row, now));
  rows.forEach((row) => samplePrice.remember(row));
  return rows.length ? rows : fill(exact);
}

/**
 * Búsqueda por rango para el bot (spec UX v1). A diferencia de search(), si la API falla
 * tira el error para que el bot muestre "Reintentar" y no descuente cuota.
 * q: { origin, destination, months: ['2026-12'], day: '2026-12-15'|null, from: ISO mínimo,
 *      oneway: bool, returnDate: ISO|null, stay: n|null }
 */
async function searchRange(q) {
  const origin = String(q.origin || '').toUpperCase();
  const destination = String(q.destination || '').toUpperCase();
  if (!pairAllowed(origin, destination)) return [];
  if (!enabled()) return [];
  const now = clock.now();
  const out = [];
  for (const m of q.months || []) {
    const payload = await get('/v2/prices/month-matrix', { origin, destination, month: `${m}-01` });
    for (const row of (payload.rows || []).map(mapRow)) {
      if (!row.actual || !Number.isFinite(row.price) || row.price <= 0) continue;
      if (!String(row.departureDate || '').startsWith(m)) continue;
      if (q.from && row.departureDate < q.from) continue;
      if (q.day && row.departureDate !== q.day) continue;
      if (q.oneway) {
        if (row.returnDate) continue;
      } else {
        if (!row.returnDate || row.returnDate <= row.departureDate) continue;
        if (q.returnDate && row.returnDate !== q.returnDate) continue;
        if (q.stay) {
          const nights = Math.round((new Date(`${row.returnDate}T00:00:00Z`) - new Date(`${row.departureDate}T00:00:00Z`)) / 86400000);
          if (nights !== Number(q.stay)) continue;
        }
      }
      if (!isFresh(row, now)) continue;
      out.push(row);
    }
  }
  out.forEach((row) => samplePrice.remember(row));
  if (!out.length && q.day) {
    return fill({ origin, destination, departureDate: q.day, returnDate: q.oneway ? null : (q.returnDate || null) });
  }
  if (!out.length && duffel.enabled()) return rangeFill({ ...q, origin, destination }, now);
  return out;
}

/** Tope total de consultas a Duffel por búsqueda por rango (además del tope por minuto/tick). */
function rangeMax() {
  const n = Number(process.env.DUFFEL_RANGE_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 6;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Fechas de muestra (día 1/10/20 de cada mes) para pares que solo cubre Duffel. */
function sampleDates(q, now) {
  const tomorrow = addDays(now.toISOString().slice(0, 10), 1);
  const dates = [];
  for (const m of q.months || []) {
    for (const day of ['01', '10', '20']) {
      const date = `${m}-${day}`;
      if (date < tomorrow) continue;
      if (q.from && date < q.from) continue;
      dates.push(date);
    }
  }
  return dates.slice(0, rangeMax());
}

function returnFor(q, date) {
  if (q.oneway) return null;
  if (q.returnDate) return q.returnDate;
  return addDays(date, q.stay ? Number(q.stay) : 14);
}

/** Relleno por rango: Duffel por fechas de muestra cuando Travelpayouts no tiene nada para el mes. */
async function rangeFill(q, now) {
  const out = [];
  for (const date of sampleDates(q, now)) {
    const returnDate = returnFor(q, date);
    if (returnDate && returnDate <= date) continue;
    const row = await duffel.cheapest({ origin: q.origin, destination: q.destination, departureDate: date, returnDate });
    if (row) out.push(row);
  }
  return out;
}

module.exports = { enabled, search, searchRange, sampleDates, rangeMax, get, mapRow, market, CURRENCY };
