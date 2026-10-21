'use strict';

const clock = require('../utils/clock');
const { pairAllowed } = require('../config/coverage');
const { isFresh, seenLabel, ageMs } = require('./sortFlights');

const HOUR_MS = 60 * 60 * 1000;

/** Última fila real guardada en este proceso. Sin red y sin precio inventado. */
let cached = null;

function remember(flight) {
  if (!flight || flight.actual === false) return;
  const price = Math.round(Number(flight.price));
  if (!Number.isFinite(price) || price <= 0) return;
  const origin = String(flight.origin || '').toUpperCase();
  const destination = String(flight.destination || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return;
  if (!pairAllowed(origin, destination)) return;
  const currency = String(flight.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return;
  const foundAt = new Date(flight.foundAt);
  if (Number.isNaN(foundAt.getTime())) return;
  let departureDate = null;
  if (flight.departureDate && /^\d{4}-\d{2}-\d{2}/.test(String(flight.departureDate))) {
    departureDate = String(flight.departureDate).slice(0, 10);
  }
  const row = {
    origin,
    destination,
    price,
    currency,
    foundAt: foundAt.toISOString(),
    departureDate,
  };
  if (!isFresh(row, clock.now())) return;
  const prev = cached ? new Date(cached.foundAt).getTime() : 0;
  const next = foundAt.getTime();
  if (!cached || next > prev || (next === prev && price < cached.price)) cached = row;
}

function current() {
  if (!cached || !isFresh(cached, clock.now())) {
    cached = null;
    return null;
  }
  const now = clock.now();
  const seenHours = Math.max(0, Math.round(ageMs(cached.foundAt, now) / HOUR_MS));
  return {
    origin: cached.origin,
    destination: cached.destination,
    departureDate: cached.departureDate,
    price: cached.price,
    currency: cached.currency,
    foundAt: cached.foundAt,
    seen: seenLabel(cached.foundAt, now),
    seenHours,
  };
}

function reset() {
  cached = null;
}

module.exports = { remember, current, reset };
