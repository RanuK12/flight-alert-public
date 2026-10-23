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

describe('auditoría OVERSEER', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const cov = require('../src/config/coverage');
  const { allPairs } = require('../src/config/airports');
  const ux = require('../src/bot/ux/places');

  function withReport(withData, fn) {
    const f = path.join(os.tmpdir(), `cov-${process.pid}-${Math.random()}.json`);
    fs.writeFileSync(f, JSON.stringify({ percent: 10, tested: [], withData }));
    process.env.COVERAGE_FILE = f;
    try { return fn(); } finally { process.env.COVERAGE_FILE = ''; fs.unlinkSync(f); }
  }

  test('allPairs incluye la vuelta Europa→LATAM (744 pares)', () => {
    const all = allPairs();
    expect(all).toHaveLength(12 * 31 * 2);
    expect(all).toContainEqual({ origin: 'MAD', destination: 'EZE' });
    expect(all).toContainEqual({ origin: 'FRA', destination: 'MEX' });
  });

  test('pairAllowed por par: con informe, un par no medido o sin datos NO se ofrece; AR no se esconde', () => {
    withReport([{ origin: 'EZE', destination: 'MAD' }, { origin: 'MVD', destination: 'MAD' }], () => {
      expect(cov.pairAllowed('EZE', 'MAD')).toBe(true);
      expect(cov.pairAllowed('MVD', 'MAD')).toBe(true);
      expect(cov.pairAllowed('MVD', 'BCN')).toBe(false);
      expect(cov.pairAllowed('MAD', 'EZE')).toBe(false); // no medido
      expect(cov.latamOriginsAvailable()).toEqual(['EZE', 'MVD']);
      expect(ux.codesFor('d', 'MVD')).toEqual(['MAD']);
      const titles = ux.originRows((c) => ({ text: c, callback_data: c })).filter((r) => r[0].callback_data === 'noop').map((r) => r[0].text);
      expect(titles).toEqual(['🇦🇷 Argentina', '🇺🇾 Uruguay']); // sin vuelta: ningún hub medido
    });
    expect(cov.pairAllowed('MAD', 'EZE')).toBe(true); // sin informe: todo
  });

  test('landing: lista de países y conteos salen del informe', () => {
    withReport([{ origin: 'EZE', destination: 'MAD' }, { origin: 'GRU', destination: 'LIS' }], () => {
      const html = require('../src/web/landing').renderLanding({ lang: 'es' });
      expect(html).toMatch(/Argentina y Brasil/);
      expect(html).not.toMatch(/monitoreadas todos los días/);
      expect(html).toMatch(/2 orígenes/);
      const en = require('../src/web/landing').renderLanding({ lang: 'en' });
      expect(en).toMatch(/Argentina &amp; Brazil|Argentina & Brazil/);
      expect(en).not.toMatch(/daily price checks/);
    });
  });

  test('título de la vuelta en EN', () => {
    const rows = ux.originRows((c) => ({ text: c, callback_data: c }), 2, 'en');
    expect(rows.flat().map((b) => b.text)).toContain('🇪🇺 Return from Europe');
    expect(rows.flat().map((b) => b.text)).toContain('🇧🇷 Brazil');
  });

  test('validate: destino desconocido o fuera de la red', () => {
    expect(flow.validate('es', { o: 'EZE', d: 'JFK' }, new Date())).not.toBeNull();
    expect(flow.validate('es', { o: 'XXX', d: 'MAD' }, new Date())).not.toBeNull();
  });

  test('schema IA: IATA desconocido y misma ciudad', () => {
    const v = (o, d) => schema.validate({ origin: o, destination: d, departDate: '2026-12-10', adults: 1 });
    expect(v('EZE', 'JFK').ok).toBe(false);
    expect(v('ZZZ', 'MAD').ok).toBe(false);
    expect(v('MAD', 'MAD').ok).toBe(false);
    expect(v('MAD', 'BCN').ok).toBe(false);
    expect(v('MAD', 'EZE').ok).toBe(true);
  });
});
