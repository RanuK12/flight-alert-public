'use strict';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function ageMs(foundAt, now) {
  if (!foundAt) return Number.POSITIVE_INFINITY;
  return now.getTime() - new Date(foundAt).getTime();
}

function isFresh(flight, now) {
  return ageMs(flight.foundAt, now) <= WEEK_MS;
}

function seenLabel(foundAt, now) {
  const h = Math.max(0, Math.round(ageMs(foundAt, now) / (60 * 60 * 1000)));
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

module.exports = { sortFlights, isFresh, seenLabel, ageMs };
