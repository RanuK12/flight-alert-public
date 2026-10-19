'use strict';

/**
 * El botón de compra va a Aviasales, que es la fuente con licencia.
 * El marker sale del entorno y no se loguea.
 */
function bookingUrl(flight) {
  const origin = flight.origin || '';
  const destination = flight.destination || '';
  const depart = String(flight.departureDate || '').slice(0, 10);
  const back = flight.returnDate ? String(flight.returnDate).slice(0, 10) : '';
  const q = `${origin}${depart}${destination}${back}`;
  const marker = process.env.TRAVELPAYOUTS_MARKER || '';
  const url = `https://www.aviasales.com/search/${encodeURIComponent(q)}`;
  return marker ? `${url}?marker=${encodeURIComponent(marker)}` : url;
}

module.exports = { bookingUrl };
