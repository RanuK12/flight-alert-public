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
  // Mismas fechas, moneda, marker y mercado que el precio que muestra el bot.
  const params = [];
  if (marker) params.push(`marker=${encodeURIComponent(marker)}`);
  params.push('currency=eur');
  const market = String(process.env.TRAVELPAYOUTS_MARKET || '').trim().toLowerCase();
  if (market) params.push(`market=${encodeURIComponent(market)}`);
  return `${url}?${params.join('&')}`;
}

module.exports = { bookingUrl };
