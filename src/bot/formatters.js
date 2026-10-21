'use strict';

const { sortFlights, seenLabel } = require('../services/sortFlights');
const clock = require('../utils/clock');

function line(flight, now) {
  const stops = flight.stops === 0 ? 'directo' : `${flight.stops} escala${flight.stops > 1 ? 's' : ''}`;
  const hours = flight.durationMin ? `${Math.round(flight.durationMin / 60)} h` : 's/d';
  return `€${flight.price} · ${stops} · ${hours} · ${flight.departureDate} · ${seenLabel(flight.foundAt, now)}`;
}

function results(flights) {
  const now = clock.now();
  const ordered = sortFlights(flights);
  if (!ordered.length) return 'No encontré precios de los últimos 7 días para esa búsqueda.';
  const cheapest = ordered[0];
  const lines = ordered.slice(0, 8).map((flight, i) => `${i === 0 ? '→' : ' '} ${line(flight, now)}`);
  return [`Lo más barato: desde €${cheapest.price} (precio aproximado, visto antes; el final lo ves en Aviasales).`, ...lines].join('\n');
}

module.exports = { line, results, sortFlights };
