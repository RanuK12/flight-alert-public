const { ORIGINS, DESTINATIONS, EU_RETURN_HUBS, pairOk, destinationsFor } = require('../src/config/airports');
const places = require('../src/bot/ux/places');
const flow = require('../src/bot/ux/flow');
const schema = require('../src/services/ai/schema');

const HUBS = ['MAD', 'BCN', 'FCO', 'MXP', 'LIS', 'CDG', 'LHR', 'FRA'];
const BACK = ['EZE', 'COR', 'GRU', 'SCL', 'MEX'];

test('pairOk: ida y vuelta válidas, nunca Europa↔Europa ni LATAM↔LATAM', () => {
  for (const o of HUBS) for (const d of BACK) { expect(pairOk(o, d)).toBe(true); expect(pairOk(d, o)).toBe(true); }
  expect(pairOk('MAD', 'BCN')).toBe(false);
  expect(pairOk('EZE', 'GRU')).toBe(false);
  expect(EU_RETURN_HUBS).toEqual(HUBS);
});

test('desde Europa los destinos son LATAM', () => {
  expect(destinationsFor('MAD')).toEqual(ORIGINS);
  expect(destinationsFor('EZE')).toEqual(DESTINATIONS);
});

test('texto: "madrid" como origen y "cordoba" como destino de vuelta', () => {
  expect(places.match('madrid', 'o').exact).toBe('MAD');
  expect(places.match('cordoba', 'd', 'MAD').exact).toBe('COR');
  expect(places.match('barcelona', 'd', 'MAD').matches).toEqual([]);
  const r = flow.applyText('es', 'b', { o: 'FCO' }, 'sao paulo');
  expect(r.fields.d).toBe('GRU');
});

test('validate y schema IA rechazan Europa→Europa, aceptan vuelta', () => {
  expect(flow.validate('es', { o: 'LIS', d: 'EZE' }, new Date())).toBeNull();
  expect(flow.validate('es', { o: 'LIS', d: 'MAD' }, new Date())).not.toBeNull();
  expect(flow.toQuery({ o: 'CDG', d: 'SCL', m: '2612', t: '1' }, new Date('2026-10-23')).origin).toBe('CDG');
});

test('selector de destino desde Europa muestra LATAM', () => {
  const r = flow.render('es', 'b', { o: 'LHR', p: '1' }, { now: new Date('2026-10-23T12:00:00Z') });
  const txt = JSON.stringify(r);
  expect(txt).toMatch(/Buenos Aires|EZE/);
  expect(txt).not.toMatch(/"MAD"|Madrid/);
});
