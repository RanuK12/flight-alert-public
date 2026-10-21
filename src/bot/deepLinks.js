'use strict';

/**
 * El botón de compra va a Aviasales, que es la fuente con licencia.
 * El marker sale del entorno y no se loguea.
 */
function ddmm(value) {
  const iso = String(value || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}${m[2]}` : '';
}

function bookingUrl(flight) {
  const origin = flight.origin || '';
  const destination = flight.destination || '';
  // Aviasales espera ORIGEN + DDMM + DESTINO + [DDMM vuelta] + adultos, p. ej. EZE1012MAD1.
  const depart = ddmm(flight.departureDate);
  const back = flight.returnDate ? ddmm(flight.returnDate) : '';
  const q = `${origin}${depart}${destination}${back}1`;
  const marker = process.env.TRAVELPAYOUTS_MARKER || '';
  const url = `https://www.aviasales.com/search/${encodeURIComponent(q)}`;
  return marker ? `${url}?marker=${encodeURIComponent(marker)}` : url;
}

module.exports = { bookingUrl };
