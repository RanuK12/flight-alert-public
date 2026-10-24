'use strict';

/**
 * Mide la cobertura de Duffel para los pares sin precio fresco en Travelpayouts (withoutData).
 * Método (DUFFEL_METHOD de src/config/coverage.js):
 *  - 3 fechas repartidas en los próximos 4 meses (+21 d, +60 d, +105 d; o DUFFEL_DATES=a,b,c).
 *  - Solo ofertas de aerolínea real: se descartan "Duffel Airways"/ZZ (duffel.isTestOffer).
 *  - Un par cuenta (withDuffel) solo con ofertas reales en ≥2 fechas. La 3.ª fecha se consulta
 *    solo si las dos primeras no deciden.
 *  - Aborta si la respuesta no es live_mode (token de prueba).
 * Solo offer requests (cotizaciones). Nunca órdenes. El token se lee del entorno y no se imprime.
 * Reanudable: progreso en DUFFEL_STATE (por defecto /tmp/duffel-measure.json).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const duffel = require('../src/providers/duffel');
const { DUFFEL_METHOD, GRANDFATHERED_ORIGINS } = require('../src/config/coverage');

const FILE = path.join(__dirname, '..', 'data', 'coverage.json');
const STATE = process.env.DUFFEL_STATE || '/tmp/duffel-measure.json';
const MIN_DATES = 2;
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));

function dates() {
  if (process.env.DUFFEL_DATES) return process.env.DUFFEL_DATES.split(',');
  const t = Date.now();
  return [21, 60, 105].map((d) => new Date(t + d * 86400000).toISOString().slice(0, 10));
}

let pauseUntil = 0;
/** ratelimit-reset puede venir como fecha HTTP o como epoch/segundos; la pausa nunca pasa de 65 s. */
function resetAt(h) {
  const v = String(h || '');
  let t = /^\d+$/.test(v) ? (Number(v) > 1e9 ? Number(v) * 1000 : Date.now() + Number(v) * 1000) : Date.parse(v);
  if (!Number.isFinite(t)) t = Date.now() + 15000;
  return Math.min(t + 500, Date.now() + 65000);
}
async function quote(origin, destination, date) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const wait = pauseUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await axios.post(`${duffel.BASE}${duffel.OFFER_PATH}`,
        { data: { slices: [{ origin, destination, departure_date: date }], passengers: [{ type: 'adult' }], cabin_class: 'economy' } },
        {
          params: { return_offers: true, supplier_timeout: 15000 },
          headers: { Authorization: `Bearer ${process.env.DUFFEL_ACCESS_TOKEN}`, 'Duffel-Version': 'v2', 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 40000,
        });
      const rem = Number(res.headers['ratelimit-remaining']);
      if (process.env.DUFFEL_DEBUG) console.log(`ok limit=${res.headers['ratelimit-limit']} rem=${rem} reset=${res.headers['ratelimit-reset']}`);
      if (rem === 0) pauseUntil = Math.max(pauseUntil, resetAt(res.headers['ratelimit-reset']));
      const d = res.data.data || {};
      if (d.live_mode === false) throw Object.assign(new Error('token de prueba (live_mode=false): abortado'), { fatal: true });
      const all = d.offers || [];
      const real = all.filter((o) => Number(o.total_amount) > 0 && !duffel.isTestOffer(o))
        .sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
      const best = real[0];
      return {
        date,
        offers: real.length,
        testOffersDropped: all.length - real.length,
        airline: best ? ((best.owner && (best.owner.name || best.owner.iata_code)) || null) : null,
        airlineIata: best ? (best.owner && best.owner.iata_code) || null : null,
        amount: best ? Number(best.total_amount) : null,
        currency: best ? best.total_currency : null,
      };
    } catch (err) {
      if (err.fatal) throw err;
      const st = err.response && err.response.status;
      if (st === 429) {
        const h = err.response.headers || {};
        pauseUntil = Math.max(pauseUntil, resetAt(h['ratelimit-reset']));
        console.log(`429 limit=${h['ratelimit-limit']} reset=${h['ratelimit-reset']}`);
        continue;
      }
      if (st === 401 || st === 403) throw Object.assign(new Error(`auth ${st}`), { fatal: true });
      if (attempt >= 2) return { date, offers: 0, error: st || err.code || 'error' };
      await sleep(3000);
    }
  }
  return { date, offers: 0, error: 'ratelimit' };
}

async function measurePair(p, ds) {
  const res = [];
  for (const date of ds) {
    res.push(await quote(p.origin, p.destination, date));
    const hits = res.filter((r) => r.offers > 0).length;
    const left = ds.length - res.length;
    if (hits >= MIN_DATES || hits + left < MIN_DATES) break;
  }
  const hits = res.filter((r) => r.offers > 0).length;
  return { origin: p.origin, destination: p.destination, datesWithOffers: hits, counts: hits >= MIN_DATES, results: res };
}

function apply(r, measured, ds) {
  r.duffelMethod = DUFFEL_METHOD;
  r.duffelDates = ds;
  r.duffelMinDates = MIN_DATES;
  r.duffelMeasured = measured;
  r.withDuffel = measured.filter((m) => m.counts).map((m) => ({
    origin: m.origin, destination: m.destination, datesWithOffers: m.datesWithOffers,
    airlines: [...new Set(m.results.filter((x) => x.offers > 0).map((x) => x.airline))],
  }));
  delete r.duffelTested;
  for (const o of Object.keys(r.byOrigin)) {
    const b = r.byOrigin[o];
    const extra = r.withDuffel.filter((p) => p.origin === o).length;
    b.withDuffel = extra;
    b.duffelMeasured = measured.filter((m) => m.origin === o).length;
    b.percentWithDuffel = Math.round(((b.with + extra) / b.total) * 1000) / 10;
  }
  r.duffelPairs = r.withDuffel.length;
  r.duffelCheckedAt = new Date().toISOString();
  return r;
}

async function main() {
  if (!duffel.enabled()) { console.log('pendiente: falta DUFFEL_ACCESS_TOKEN'); return; }
  const r = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ds = dates();
  let st = { dates: ds, done: {} };
  try { const prev = JSON.parse(fs.readFileSync(STATE, 'utf8')); if (prev.dates.join() === ds.join()) st = prev; } catch { /* nuevo */ }
  // Primero los orígenes que dependen del umbral; los argentinos (grandfathered) al final.
  const todo = [...r.withoutData].sort((a, b) => GRANDFATHERED_ORIGINS.includes(a.origin) - GRANDFATHERED_ORIGINS.includes(b.origin))
    .filter((p) => !st.done[`${p.origin}-${p.destination}`]);
  const conc = Number(process.env.DUFFEL_CONCURRENCY || 3);
  let i = 0;
  let n = 0;
  async function worker() {
    while (i < todo.length) {
      const p = todo[i++];
      const m = await measurePair(p, ds);
      st.done[`${p.origin}-${p.destination}`] = m;
      n += 1;
      if (n % 10 === 0) { fs.writeFileSync(STATE, JSON.stringify(st)); console.log(`progreso ${Object.keys(st.done).length}/${r.withoutData.length}`); }
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  fs.writeFileSync(STATE, JSON.stringify(st));
  const measured = r.withoutData.map((p) => st.done[`${p.origin}-${p.destination}`]).filter(Boolean);
  if (measured.length < r.withoutData.length && !process.env.DUFFEL_ALLOW_PARTIAL) { console.log('incompleto; reanudar'); return; }
  fs.writeFileSync(FILE, `${JSON.stringify(apply(r, measured, ds), null, 2)}\n`);
  const out = {};
  for (const o of Object.keys(r.byOrigin)) out[o] = `${r.byOrigin[o].percent}→${r.byOrigin[o].percentWithDuffel}`;
  console.log(JSON.stringify({ dates: ds, measured: measured.length, counted: r.withDuffel.length, byOrigin: out }));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });

module.exports = { apply, measurePair, dates };
