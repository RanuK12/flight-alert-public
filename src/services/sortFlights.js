'use strict';

/** Solo precios vistos en las últimas 48 h (antes 7 días). */
const FRESH_MS = 48 * 60 * 60 * 1000;

function ageMs(foundAt, now) {
  if (!foundAt) return Number.POSITIVE_INFINITY;
  return now.getTime() - new Date(foundAt).getTime();
}

function isFresh(flight, now) {
  return ageMs(flight.foundAt, now) <= FRESH_MS;
}

function seenLabel(foundAt, now, lang = 'es') {
  const h = Math.max(0, Math.round(ageMs(foundAt, now) / (60 * 60 * 1000)));
  if (lang === 'en') return `seen ${h} h ago`;
  if (lang === 'pt') return `visto há ${h} h`;
  return `visto hace ${h} h`;
}

/**
 * Precio, después escalas, después duración, después fecha.
 */
function sortFlights(list) {
  return [...list].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    const stopsA = a.stops ?? 99;
    const stopsB = b.stops ?? 99;
    if (stopsA !== stopsB) return stopsA - stopsB;
    const durA = a.durationMin ?? 1e9;
    const durB = b.durationMin ?? 1e9;
    if (durA !== durB) return durA - durB;
    return String(a.departureDate || '').localeCompare(String(b.departureDate || ''));
  });
}

module.exports = { sortFlights, isFresh, seenLabel, ageMs, FRESH_MS };
