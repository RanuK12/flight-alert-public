'use strict';

/**
 * Compatibilidad con main: sin `flex_dias` (o con flex_dias=0) el hash de búsqueda, las fechas de muestra y el
 * resultado de searchRange tienen que ser idénticos, byte a byte, a los de main. Los valores de FIXTURE se
 * calcularon haciendo checkout de main (origin/main ab6867d) y corriendo este mismo cómputo ahí.
 */
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset } = require('../src/database');
const search = require('../src/services/search');
const tp = require('../src/providers/travelpayouts');
const { queryFrom } = require('../src/bot/handlers/naturalSearch');

const NOW = new Date('2026-10-22T12:00:00Z');

const QUERIES = [
  { origin: 'COR', destination: 'MAD', departureDate: '2026-12-10', returnDate: null, adults: 1 },
  { origin: 'cor', destination: 'mad', departureDate: '2026-12-10', returnDate: '2026-12-24', adults: 2 },
  { origin: 'EZE', destination: 'FCO', months: ['2026-12'], oneway: true },
  { origin: 'COR', destination: 'BCN', months: ['2026-11', '2026-12'], oneway: false, stay: 14 },
  { origin: 'ROS', destination: 'MAD', months: ['2027-01'], day: '2027-01-15', oneway: true },
  { origin: 'COR', destination: 'MAD', months: ['2026-12'], from: '2026-12-05', oneway: false, stay: 7 },
  { origin: 'EZE', destination: 'MIA', departureDate: '2026-11-03', returnDate: null, adults: 1, flexDays: 0 },
  { origin: 'COR', destination: 'LIS', months: ['2026-12'], oneway: true, stay: null },
];
const SAMPLES = [
  { months: ['2026-12'] },
  { months: ['2026-11', '2026-12'], from: '2026-12-05' },
  { months: ['2027-01'], day: '2027-01-15' },
];
const RANGES = [
  { origin: 'MEX', destination: 'MAD', months: ['2026-12'], oneway: true },
  { origin: 'MEX', destination: 'MAD', months: ['2026-12'], from: '2026-12-08', oneway: true },
  { origin: 'MEX', destination: 'MAD', months: ['2026-12'], oneway: false, stay: 14 },
  { origin: 'MEX', destination: 'MAD', months: ['2026-12'], oneway: false, returnDate: '2026-12-24' },
  { origin: 'MEX', destination: 'MAD', months: ['2026-12'], day: '2026-12-15', oneway: true },
];
const ROWS = [
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-03', return_date: null, value: 410, actual: true, found_at: '2026-10-22T10:00:00Z' },
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-10', return_date: null, value: 395, actual: true, found_at: '2026-10-22T10:00:00Z' },
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-15', return_date: null, value: 430, actual: true, found_at: '2026-10-22T10:00:00Z' },
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-10', return_date: '2026-12-24', value: 760, actual: true, found_at: '2026-10-22T10:00:00Z' },
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-12', return_date: '2026-12-26', value: 790, actual: true, found_at: '2026-10-22T10:00:00Z' },
  { origin: 'MEX', destination: 'MAD', depart_date: '2026-12-20', return_date: '2026-12-30', value: 720, actual: true, found_at: '2026-10-22T10:00:00Z' },
];

async function compute() {
  const hashes = QUERIES.map((q) => search.queryHash(q));
  const dates = SAMPLES.map((q) => tp.sampleDates(q, NOW));
  const ranges = [];
  for (const q of RANGES) ranges.push(await tp.searchRange(q));
  return { hashes, dates, ranges };
}

let covFile;
beforeEach(() => {
  cleanEnv(); reset(); clock.reset(); clock.setNow(NOW);
  axios.get.mockReset();
  axios.get.mockImplementation(async (url) => {
    if (url.includes('travelpayouts')) return { data: { data: ROWS }, headers: {} };
    throw new Error(`url inesperada ${url}`);
  });
  process.env.TRAVELPAYOUTS_TOKEN = 'tp-test';
  covFile = path.join(os.tmpdir(), `cov-flex-${process.pid}.json`);
  fs.writeFileSync(covFile, JSON.stringify({
    withData: [{ origin: 'MEX', destination: 'MAD' }],
    withDuffel: [{ origin: 'MEX', destination: 'MAD' }],
    byOrigin: { MEX: { with: 1, total: 1, percent: 100, percentWithDuffel: 100 } },
  }));
  process.env.COVERAGE_FILE = covFile;
});
afterEach(() => { cleanEnv(); clock.reset(); try { fs.unlinkSync(covFile); } catch (_) { /* */ } });

// Generado en main con: FAP_GEN=/tmp/fixture.json npx jest tests/flex-compat (checkout de origin/main).
const FIXTURE = {
  "hashes": [
    "2068eb60268ecc665e02920631644c78e6c107b1a880f348e9d9028744971e83",
    "e18a2e0b7aa36eb3479758cde943c69a5cd58b165d6f86c7d23d07e11b65a57b",
    "7ca7fe2400f49027bc1564bcf54b693cbfaa3d34d80406fcf70abda1adedfad3",
    "8cc448f21c725cf47e24e10d6ac0b4a00214de792af0db6a5e09e9591621e8b0",
    "b91dbe9b6fdc4ea54b9ebd28ca20e514a724e8e43d3be67560cf4a767d8d4c67",
    "f6cf5a7398983c10c39e60f4bcb20f9930d143888544fc7602808b3ce52c94db",
    "5c68013fa124d50c390967f5725835b6c9fd9e913846a1149b6a79cd031ee802",
    "cfe616148bb46ca16e997ceac6e0dd07a7a4f3040cd0c467fb093e94e43aa551"
  ],
  "dates": [
    [
      "2026-12-01",
      "2026-12-10",
      "2026-12-20"
    ],
    [
      "2026-12-10",
      "2026-12-20"
    ],
    [
      "2027-01-01",
      "2027-01-10",
      "2027-01-20"
    ]
  ],
  "ranges": [
    [
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-03",
        "returnDate": null,
        "price": 410,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      },
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-10",
        "returnDate": null,
        "price": 395,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      },
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-15",
        "returnDate": null,
        "price": 430,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      }
    ],
    [
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-10",
        "returnDate": null,
        "price": 395,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      },
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-15",
        "returnDate": null,
        "price": 430,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      }
    ],
    [
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-10",
        "returnDate": "2026-12-24",
        "price": 760,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      },
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-12",
        "returnDate": "2026-12-26",
        "price": 790,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      }
    ],
    [
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-10",
        "returnDate": "2026-12-24",
        "price": 760,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      }
    ],
    [
      {
        "origin": "MEX",
        "destination": "MAD",
        "departureDate": "2026-12-15",
        "returnDate": null,
        "price": 430,
        "currency": "EUR",
        "stops": 0,
        "durationMin": null,
        "foundAt": "2026-10-22T10:00:00Z",
        "actual": true,
        "gate": null
      }
    ]
  ]
};

if (process.env.FAP_GEN) {
  test('gen', async () => { fs.writeFileSync(process.env.FAP_GEN, JSON.stringify(await compute())); });
} else {
  describe('compatibilidad byte a byte con main (sin ventana flexible)', () => {
    test('queryHash idéntico al de main para consultas representativas', async () => {
      expect((await compute()).hashes).toEqual(FIXTURE.hashes);
    });
    test('sampleDates idéntico al de main', async () => {
      expect((await compute()).dates).toEqual(FIXTURE.dates);
    });
    test('searchRange sin `to` devuelve exactamente lo mismo que main', async () => {
      expect((await compute()).ranges).toEqual(FIXTURE.ranges);
    });
    test('flex_dias=0 / sin campo IA: queryFrom no agrega from/to y el hash no cambia', () => {
      const v = { origin: 'COR', destination: 'MAD', departDate: '2026-12-10', returnDate: null, adults: 1 };
      for (const flexDays of [0, undefined, null]) {
        const q = queryFrom({ ...v, flexDays }, '2026-10-22');
        expect(q).toEqual({ origin: 'COR', destination: 'MAD', departureDate: '2026-12-10', returnDate: null, adults: 1 });
        expect(search.queryHash(q)).toBe(FIXTURE.hashes[0]);
      }
    });
    test('con ventana flexible el hash distingue la ventana (solo ahí cambia)', () => {
      const base = { origin: 'COR', destination: 'MAD', months: ['2026-12'], oneway: true };
      expect(search.queryHash(base)).toBe(search.queryHash({ ...base }));
      expect(search.queryHash({ ...base, from: '2026-12-01', to: '2026-12-05' })).not.toBe(search.queryHash(base));
    });
  });
}
