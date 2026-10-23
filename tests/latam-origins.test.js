'use strict';

const { ORIGINS, AR_ORIGINS, ORIGIN_GROUPS, groupOf } = require('../src/config/airports');
const places = require('../src/bot/ux/places');
const { resolveCode } = require('../src/services/ai/schema');
const country = require('../src/services/country');

test('Argentina sigue primera, con los mismos 5 orígenes y en el mismo orden', () => {
  expect(ORIGIN_GROUPS[0].country).toBe('AR');
  expect(AR_ORIGINS).toEqual(['EZE', 'COR', 'MDQ', 'ROS', 'BUE']);
  expect(ORIGINS.slice(0, 5)).toEqual(AR_ORIGINS);
});

test('hubs LATAM agregados, cada uno con nombre y país', () => {
  for (const code of ['GRU', 'GIG', 'SCL', 'MVD', 'LIM', 'BOG', 'MEX']) {
    expect(ORIGINS).toContain(code);
    expect(places.PLACES[code]).toBeTruthy();
    expect(groupOf(code).country).not.toBe('AR');
  }
  expect(new Set(ORIGINS).size).toBe(ORIGINS.length);
});

test('selector de origen agrupado por país: fila-título noop + botones del país', () => {
  const rows = places.originRows((c) => ({ text: c, callback_data: `x:${c}` }));
  const titles = rows.filter((r) => r.length === 1 && r[0].callback_data === 'noop').map((r) => r[0].text);
  expect(titles[0]).toBe('🇦🇷 Argentina');
  expect(titles).toHaveLength(ORIGIN_GROUPS.length + 1);
  expect(titles[titles.length - 1]).toBe('🇪🇺 Vuelta desde Europa');
  const codes = rows.flat().filter((b) => b.callback_data !== 'noop').map((b) => b.text);
  expect(codes).toEqual([...ORIGINS, 'MAD', 'BCN', 'FCO', 'MXP', 'LIS', 'CDG', 'LHR', 'FRA']);
});

test('búsqueda por texto y la IA resuelven las ciudades nuevas', () => {
  expect(places.match('santiago', 'o').exact).toBe('SCL');
  expect(places.match('montevideo', 'o').exact).toBe('MVD');
  expect(places.match('cdmx', 'o').exact).toBe('MEX');
  expect(places.match('GRU', 'o').exact).toBe('GRU');
  expect(places.match('buenos aires', 'o').matches[0]).toBe('EZE');
  expect(resolveCode('Lima')).toBe('LIM');
  expect(resolveCode('Bogotá')).toBe('BOG');
});

test('precio de Pro: USD para LATAM no AR, MP/ARS solo para AR con IP AR', () => {
  for (const c of ['BR', 'CL', 'UY', 'PE', 'CO', 'MX', 'OTRO']) {
    expect(country.currencyFor(c, c)).toMatchObject({ rail: 'stripe', currency: 'USD' });
  }
  expect(country.currencyFor('AR', 'AR')).toMatchObject({ rail: 'mp', currency: 'ARS' });
  expect(country.currencyFor('AR', 'BR')).toMatchObject({ rail: 'stripe', currency: 'USD' });
});
