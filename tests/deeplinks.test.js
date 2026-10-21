'use strict';

const { bookingUrl } = require('../src/bot/deepLinks');

test('link de Aviasales con formato ORIGEN+DDMM+DESTINO+adultos', () => {
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  expect(bookingUrl({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10' }))
    .toBe('https://www.aviasales.com/search/EZE1012MAD1?marker=793462&currency=eur');
  expect(bookingUrl({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10T00:00:00Z', returnDate: '2027-01-05' }))
    .toBe('https://www.aviasales.com/search/EZE1012MAD05011?marker=793462&currency=eur');
});
