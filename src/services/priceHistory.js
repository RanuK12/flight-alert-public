'use strict';

const { col } = require('../database');
const art = require('../utils/art');

const TTL_DAYS = 35;

/** Clave estable de una ruta (misma que agrupa los ticks de alertas). */
function routeKey(r) {
  return [r.origin, r.destination, r.outboundDate, r.returnDate || '', r.tripType || '', r.flexMonth || '', r.stayDays || ''].join('|');
}

function dayOf(now) {
  return art.parts(now).day;
}

/** Guarda el mínimo del día (ART) para la ruta. Una fila por ruta por día. */
async function record(route, flight, now) {
  const price = Math.round(Number(flight && flight.price));
  if (!Number.isFinite(price) || price <= 0) return false;
  const key = routeKey(route);
  const date = dayOf(now);
  const filter = { routeKey: key, date };
  // Un solo upsert atómico: $min conserva el precio más bajo aunque haya ticks en paralelo.
  // Los metadatos (fuente, fechas) se fijan al insertar; el resto del día solo baja el mínimo.
  const update = {
    $min: { minPrice: price },
    $set: { expiresAt: new Date(now.getTime() + TTL_DAYS * art.DAY_MS) },
    $setOnInsert: {
      routeKey: key,
      date,
      currency: flight.currency || 'EUR',
      source: flight.source || 'travelpayouts',
      departureDate: flight.departureDate || null,
      returnDate: flight.returnDate || null,
      oneway: route.tripType !== 'roundtrip' && !route.returnDate && !route.stayDays,
    },
  };
  const C = col('PriceHistory');
  try {
    await C.updateOne(filter, update, { upsert: true });
  } catch (err) {
    // Dos upserts simultáneos sobre el índice único: el perdedor reintenta como update.
    if (err && err.code === 11000) await C.updateOne(filter, update);
    else throw err;
  }
  return true;
}

/** Historial de los últimos `days` días (ART), ordenado por fecha. */
async function history(route, now, days = 30) {
  const from = dayOf(new Date(now.getTime() - (days - 1) * art.DAY_MS));
  const rows = await col('PriceHistory').find({ routeKey: routeKey(route), date: { $gte: from } }).lean();
  return rows
    .filter((r) => Number(r.minPrice) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((r) => ({ date: r.date, price: Number(r.minPrice), currency: r.currency || 'EUR', source: r.source || null }));
}

module.exports = { routeKey, record, history, dayOf, TTL_DAYS };
