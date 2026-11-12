'use strict';

/**
 * Ceiling suggestion (GET /app/api/suggest) and price series (GET /app/api/alerts/:id/series)
 * backed by real observed daily points in MarketPrice (or observed PriceHistory fallback).
 * Threshold factor = 0.85 * median when samples >= 10; <10 days => cold/none without guessing.
 */

const { col } = require('../database');
const clock = require('../utils/clock');
const art = require('../utils/art');
const { isFinite } = Number;

const MIN_SAMPLES = 10;
const MEDIAN_FACTOR = 0.85;
const MIN_CEILING = 50;
const MAX_SERIES_POINTS = 30;

function routeMarketKey(origin, destination, tripType) {
  const o = String(origin || '').toUpperCase();
  const d = String(destination || '').toUpperCase();
  const t = tripType === 'roundtrip' || tripType === 'round' ? 'roundtrip' : 'oneway';
  return `${o}|${d}|${t}`;
}

function medianOf(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Records a daily observed price into MarketPrice (idempotent $min on min price). */
async function recordObservation({ origin, destination, tripType, obsDate, price, currency = 'EUR', source = 'travelpayouts' }) {
  const val = Math.round(Number(price));
  if (!isFinite(val) || val <= 0 || !origin || !destination) return false;
  const day = obsDate || art.parts(clock.now()).day;
  const o = String(origin).toUpperCase();
  const d = String(destination).toUpperCase();
  const t = tripType === 'roundtrip' || tripType === 'round' ? 'roundtrip' : 'oneway';
  const routeKey = routeMarketKey(o, d, t);
  const filter = { routeKey, obsDate: day };
  const update = {
    $min: { min: val },
    $setOnInsert: { routeKey, origin: o, destination: d, tripType: t, obsDate: day, median: val, currency, source },
  };
  const C = col('MarketPrice');
  try {
    await C.updateOne(filter, update, { upsert: true });
  } catch (err) {
    if (err && err.code === 11000) await C.updateOne(filter, update);
    else throw err;
  }
  return true;
}

async function distinctDailyMins({ origin, destination, tripType }) {
  const o = String(origin || '').toUpperCase();
  const d = String(destination || '').toUpperCase();
  const t = tripType === 'roundtrip' || tripType === 'round' ? 'roundtrip' : 'oneway';
  const rows = await col('MarketPrice').find({ origin: o, destination: d, tripType: t }).lean();
  const byDay = new Map();
  for (const r of rows) {
    const val = Number(r.min);
    if (!isFinite(val) || val <= 0 || !r.obsDate) continue;
    const prev = byDay.get(r.obsDate);
    if (prev === undefined || val < prev) byDay.set(r.obsDate, val);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([obsDate, min]) => ({ obsDate, min: Math.round(min) }));
}

async function suggestPrice({ origin, destination, tripType }) {
  const daily = await distinctDailyMins({ origin, destination, tripType });
  const samples = daily.length;
  if (samples === 0) {
    return { suggested: null, confidence: 'none', samples: 0, currency: 'EUR' };
  }
  if (samples < MIN_SAMPLES) {
    return { suggested: null, confidence: 'cold', samples, currency: 'EUR' };
  }
  const recent = daily.slice(-60);
  const med = medianOf(recent.map((x) => x.min));
  const suggested = Math.max(MIN_CEILING, Math.round(med * MEDIAN_FACTOR));
  return {
    suggested,
    confidence: 'ok',
    samples,
    currency: 'EUR',
    median: Math.round(med),
  };
}

/** Up to 30 real observed daily points for the Mini App series chart. */
async function getAlertSeries(route, limit = MAX_SERIES_POINTS) {
  const cap = Math.min(Math.max(1, Number(limit) || MAX_SERIES_POINTS), MAX_SERIES_POINTS);
  const daily = await distinctDailyMins({
    origin: route.origin,
    destination: route.destination,
    tripType: route.tripType,
  });
  if (daily.length) {
    return daily.slice(-cap);
  }
  // Fallback to observed PriceHistory rows for exact matching routeKey (no interpolation).
  const key = require('./priceHistory').routeKey(route);
  const histRows = await col('PriceHistory').find({ routeKey: key }).lean();
  return histRows
    .filter((r) => isFinite(Number(r.minPrice)) && Number(r.minPrice) > 0 && r.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-cap)
    .map((r) => ({ obsDate: r.date, min: Math.round(Number(r.minPrice)) }));
}

module.exports = {
  MIN_SAMPLES,
  MEDIAN_FACTOR,
  MAX_SERIES_POINTS,
  routeMarketKey,
  medianOf,
  recordObservation,
  suggestPrice,
  getAlertSeries,
};
