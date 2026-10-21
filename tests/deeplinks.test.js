'use strict';

const { bookingUrl } = require('../src/bot/deepLinks');

test('link de Aviasales con formato ORIGEN+DDMM+DESTINO+adultos', () => {
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  expect(bookingUrl({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10' }))
    .toBe('https://www.aviasales.com/search/EZE1012MAD1?marker=793462&currency=eur');
  expect(bookingUrl({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10T00:00:00Z', returnDate: '2027-01-05' }))
    .toBe('https://www.aviasales.com/search/EZE1012MAD05011?marker=793462&currency=eur');
});

test('el link lleva el mercado si está configurado', () => {
  process.env.TRAVELPAYOUTS_MARKER = '793462';
  process.env.TRAVELPAYOUTS_MARKET = 'ES';
  expect(bookingUrl({ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10' }))
    .toBe('https://www.aviasales.com/search/EZE1012MAD1?marker=793462&currency=eur&market=es');
  delete process.env.TRAVELPAYOUTS_MARKET;
});

test('el encabezado dice hace cuánto se vio el precio', () => {
  const fmt = require('../src/bot/formatters');
  const foundAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const text = fmt.results([{ origin: 'EZE', destination: 'MAD', departureDate: '2026-12-10', price: 500, stops: 0, durationMin: 720, foundAt }]);
  expect(text.split('\n')[0]).toMatch(/desde €500, visto hace 5 h/);
});
