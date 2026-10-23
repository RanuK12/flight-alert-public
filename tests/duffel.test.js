'use strict';

jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../src/bot/notifier', () => ({ send: jest.fn().mockResolvedValue(true) }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const duffel = require('../src/providers/duffel');
const travelpayouts = require('../src/providers/travelpayouts');
const notifier = require('../src/bot/notifier');
const instant = require('../src/services/instantAlerts');
const { isFresh, seenLabel, FRESH_MS } = require('../src/services/sortFlights');
const cov = require('../src/config/coverage');

const HOUR = 3600000;
const NOW = '2026-10-21T15:00:00.000Z'; // 12:00 ART

function offerResponse(amount, currency = 'USD', segs = 2) {
  return { data: { data: { live_mode: false, offers: [
    { total_amount: String(amount + 100), total_currency: currency, owner: { iata_code: 'IB' }, slices: [{ duration: 'PT14H5M', segments: Array(segs).fill({}) }] },
    { total_amount: String(amount), total_currency: currency, owner: { iata_code: 'LA' }, slices: [{ duration: 'P1DT2H', segments: Array(segs).fill({}) }] },
  ] } }, headers: {} };
}
const fxResponse = { data: { rates: { EUR: 0.9 } } };
function tpRows(q, price, hoursAgo = 2) {
  return { data: { data: [{ origin: q.o, destination: q.d, depart_date: '2026-12-10', value: price, number_of_changes: 1, found_at: new Date(Date.parse(NOW) - hoursAgo * HOUR).toISOString(), actual: true }] }, headers: {} };
}
function routeAxios({ tp = null, duffelImpl = null } = {}) {
  axios.get.mockImplementation(async (url) => {
    if (url.includes('frankfurter')) return fxResponse;
    if (url.includes('travelpayouts')) return tp || { data: { data: [] }, headers: {} };
    throw new Error(`url inesperada ${url}`);
  });
  axios.post.mockImplementation(duffelImpl || (async () => offerResponse(500)));
}

beforeEach(() => {
  cleanEnv(); reset(); duffel.reset(); clock.reset();
  clock.setNow(new Date(NOW));
  axios.get.mockReset(); axios.post.mockReset(); notifier.send.mockClear();
  process.env.FEATURE_INSTANT_ALERTS = 'on';
  process.env.TRAVELPAYOUTS_TOKEN = 'tp-test';
});
afterEach(() => { cleanEnv(); clock.reset(); });

const Q = { origin: 'MEX', destination: 'MAD', departureDate: '2026-12-10', returnDate: null };

describe('proveedor Duffel', () => {
  test('sin DUFFEL_ACCESS_TOKEN está apagado y no llama a nada', async () => {
    routeAxios();
    expect(duffel.enabled()).toBe(false);
    expect(await duffel.cheapest(Q)).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
  });

  test('cotiza la oferta más barata, convierte USD→EUR, mapea escalas/duración y cachea', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    const row = await duffel.cheapest(Q);
    expect(row).toMatchObject({ origin: 'MEX', destination: 'MAD', price: 450, currency: 'EUR', stops: 1, durationMin: 1560, source: 'duffel', foundAt: NOW });
    await duffel.cheapest(Q);
    expect(axios.post).toHaveBeenCalledTimes(1);
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toBe('https://api.duffel.com/air/offer_requests');
    expect(body.data.slices).toEqual([{ origin: 'MEX', destination: 'MAD', departure_date: '2026-12-10' }]);
    expect(cfg.headers.Authorization).toBe('Bearer duffel_test_x');
    expect(cfg.headers['Duffel-Version']).toBe('v2');
  });

  test('ida y vuelta manda dos slices', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ duffelImpl: async () => offerResponse(700, 'EUR') });
    const row = await duffel.cheapest({ ...Q, returnDate: '2026-12-24' });
    expect(axios.post.mock.calls[0][1].data.slices).toHaveLength(2);
    expect(row.price).toBe(700);
  });

  test('tope por minuto: el excedente devuelve null sin llamar; después de un minuto vuelve', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    process.env.DUFFEL_MAX_PER_MIN = '2';
    routeAxios();
    await duffel.cheapest({ ...Q, departureDate: '2026-12-11' });
    await duffel.cheapest({ ...Q, departureDate: '2026-12-12' });
    expect(await duffel.cheapest({ ...Q, departureDate: '2026-12-13' })).toBeNull();
    expect(axios.post).toHaveBeenCalledTimes(2);
    clock.setNow(new Date(Date.parse(NOW) + 61000));
    expect(await duffel.cheapest({ ...Q, departureDate: '2026-12-13' })).not.toBeNull();
  });

  test('error, timeout, 429 o moneda sin cambio → null silencioso; 429 frena un minuto', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ duffelImpl: async () => { const e = new Error('boom'); e.response = { status: 500 }; throw e; } });
    expect(await duffel.cheapest(Q)).toBeNull();
    routeAxios({ duffelImpl: async () => { const e = new Error('rl'); e.response = { status: 429 }; throw e; } });
    expect(await duffel.cheapest({ ...Q, departureDate: '2026-12-11' })).toBeNull();
    routeAxios();
    axios.post.mockClear();
    expect(await duffel.cheapest({ ...Q, departureDate: '2026-12-12' })).toBeNull();
    expect(axios.post).not.toHaveBeenCalled();
    duffel.reset();
    axios.get.mockImplementation(async () => { throw new Error('fx caído'); });
    expect(await duffel.cheapest(Q)).toBeNull();
  });

  test('nunca crea órdenes: el código no referencia endpoints de órdenes/pagos', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'providers', 'duffel.js'), 'utf8');
    expect(src).not.toMatch(/\/air\/orders|\/payments|order_change|\/air\/payments/);
    expect(duffel.OFFER_PATH).toBe('/air/offer_requests');
  });
});

describe('Travelpayouts + relleno Duffel', () => {
  test('si TP no tiene precio fresco, rellena con Duffel', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios();
    const rows = await travelpayouts.search(Q);
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('duffel');
  });
  test('sin token, TP vacío → vacío (sin Duffel)', async () => {
    routeAxios();
    expect(await travelpayouts.search(Q)).toEqual([]);
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('TP con precio fresco no llama a Duffel en la búsqueda', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480) });
    const rows = await travelpayouts.search(Q);
    expect(rows[0].price).toBe(480);
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('ventana de 48 h: un precio de TP de 50 h no se usa', async () => {
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480, 50) });
    expect(await travelpayouts.search(Q)).toEqual([]);
    expect(FRESH_MS).toBe(48 * HOUR);
    const now = new Date(NOW);
    expect(isFresh({ foundAt: new Date(now - 47 * HOUR).toISOString() }, now)).toBe(true);
    expect(isFresh({ foundAt: new Date(now - 49 * HOUR).toISOString() }, now)).toBe(false);
  });
  test('"visto hace X h" en es, en y pt', () => {
    const now = new Date(NOW);
    const f = new Date(now - 5 * HOUR).toISOString();
    expect(seenLabel(f, now)).toBe('visto hace 5 h');
    expect(seenLabel(f, now, 'en')).toBe('seen 5 h ago');
    expect(seenLabel(f, now, 'pt')).toBe('visto há 5 h');
  });
});

describe('re-verificación antes de avisar', () => {
  async function setup(threshold = 500, lang) {
    await col('Entitlement').create({ telegramUserId: '1', plan: 'pro', searchesUsed: 0, proUntil: '2026-12-31T00:00:00Z' });
    await col('Route').create({ telegramUserId: '1', telegramChatId: '1', origin: 'MEX', destination: 'MAD', tripType: 'oneway', outboundDate: '2026-12-10', returnDate: null, priceThreshold: threshold, paused: false, ...(lang ? { lang } : {}) });
  }
  test('Duffel distinto y bajo el techo: manda el precio verificado', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480), duffelImpl: async () => offerResponse(470, 'EUR') });
    await setup();
    const out = await instant.run({});
    expect(out.sent).toBe(1);
    const text = notifier.send.mock.calls[0][2];
    expect(text).toMatch(/€470/);
    expect(text).toMatch(/visto hace 0 h/);
    expect(text).toMatch(/verificado/);
  });
  test('Duffel arriba del techo: no avisa', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480), duffelImpl: async () => offerResponse(620, 'EUR') });
    await setup();
    expect((await instant.run({})).sent).toBe(0);
    expect(notifier.send).not.toHaveBeenCalled();
  });
  test('Duffel falla: fallback silencioso al precio de TP', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480), duffelImpl: async () => { throw new Error('down'); } });
    await setup();
    expect((await instant.run({})).sent).toBe(1);
    expect(notifier.send.mock.calls[0][2]).toMatch(/€480[\s\S]*visto hace 2 h[\s\S]*caché/);
  });
  test('sin token: no hay verificación, avisa con TP', async () => {
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480) });
    await setup();
    expect((await instant.run({})).sent).toBe(1);
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('TP arriba de todos los techos: no gasta llamada a Duffel', async () => {
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 900) });
    await setup();
    await instant.run({});
    expect(axios.post).not.toHaveBeenCalled();
  });
  test('aviso en inglés y portugués según la alerta', async () => {
    routeAxios({ tp: tpRows({ o: 'MEX', d: 'MAD' }, 480) });
    await setup(500, 'en');
    await instant.run({});
    expect(notifier.send.mock.calls[0][2]).toMatch(/Price drop[\s\S]*seen 2 h ago/);
    const m = instant.messageFor({ lang: 'pt', priceThreshold: 500 }, { origin: 'GRU', destination: 'LIS', price: 400, departureDate: '2026-12-10', foundAt: new Date(Date.parse(NOW) - 3 * HOUR).toISOString() }, new Date(NOW));
    expect(m).toMatch(/O preço caiu[\s\S]*visto há 3 h/);
  });
});

describe('cobertura con Duffel', () => {
  test('pares solo-Duffel se habilitan únicamente con token; el umbral usa percentWithDuffel', () => {
    const f = path.join(os.tmpdir(), `cov-duffel-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({
      withData: [{ origin: 'MEX', destination: 'MAD' }],
      withDuffel: [{ origin: 'MEX', destination: 'BCN' }],
      byOrigin: { MEX: { with: 1, total: 2, percent: 50, percentWithDuffel: 100 } },
    }));
    process.env.COVERAGE_FILE = f;
    try {
      expect(cov.pairAllowed('MEX', 'MAD')).toBe(false); // 50 % < 60 sin Duffel
      process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_x';
      expect(cov.pairAllowed('MEX', 'MAD')).toBe(true);
      expect(cov.pairAllowed('MEX', 'BCN')).toBe(true);
    } finally { process.env.COVERAGE_FILE = 'off'; fs.unlinkSync(f); }
  });
});
