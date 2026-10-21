'use strict';

const axios = require('axios');
const logger = require('../utils/logger').child('travelpayouts');
const { pairAllowed } = require('../config/coverage');
const { isFresh } = require('../services/sortFlights');
const clock = require('../utils/clock');

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
  if (!enabled()) return [];
  const month = `${String(query.departureDate).slice(0, 7)}-01`;
  let payload;
  try {
    payload = await get('/v2/prices/month-matrix', { origin, destination, month });
  } catch (err) {
    logger.warn('travelpayouts no respondió', { error: err.message });
    return [];
  }
  const now = clock.now();
  return payload.rows
    .map(mapRow)
    .filter((row) => row.actual && Number.isFinite(row.price) && row.price > 0)
    .filter((row) => row.departureDate === query.departureDate)
    .filter((row) => (query.returnDate ? row.returnDate === query.returnDate : !row.returnDate))
    .filter((row) => isFresh(row, now));
}

module.exports = { enabled, search, get, mapRow, market, CURRENCY };
