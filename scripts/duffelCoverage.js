'use strict';

/**
 * Suma Duffel al informe de cobertura. Para cada par sin precio fresco en Travelpayouts
 * (de COVERAGE_ORIGINS), cotiza UNA fecha de muestra (DUFFEL_SAMPLE_DATE, por defecto el día 10
 * de dentro de 2 meses) vía offer request. Nunca crea órdenes. Respeta el tope local de duffel.js.
 * Incremental: guarda duffelTested en data/coverage.json y no repite pares.
 */

const fs = require('fs');
const path = require('path');
const duffel = require('../src/providers/duffel');

const FILE = path.join(__dirname, '..', 'data', 'coverage.json');

function sampleDate() {
  if (process.env.DUFFEL_SAMPLE_DATE) return process.env.DUFFEL_SAMPLE_DATE;
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 10)).toISOString().slice(0, 10);
}

function recompute(r) {
  const key = (p) => `${p.origin}-${p.destination}`;
  const live = new Set((r.withDuffel || []).map(key));
  for (const o of Object.keys(r.byOrigin)) {
    const b = r.byOrigin[o];
    const extra = (r.withDuffel || []).filter((p) => p.origin === o).length;
    b.withDuffel = extra;
    b.percentWithDuffel = Math.round(((b.with + extra) / b.total) * 1000) / 10;
  }
  r.duffelPairs = live.size;
  return r;
}

async function main() {
  if (!duffel.enabled()) { console.log('pendiente: falta DUFFEL_ACCESS_TOKEN'); return; }
  const r = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  r.withDuffel = r.withDuffel || [];
  r.duffelTested = r.duffelTested || [];
  const done = new Set(r.duffelTested.map((p) => `${p.origin}-${p.destination}`));
  const only = (process.env.COVERAGE_ORIGINS || '').split(',').filter(Boolean);
  const date = sampleDate();
  const todo = r.withoutData.filter((p) => (!only.length || only.includes(p.origin)) && !done.has(`${p.origin}-${p.destination}`));
  const deadline = Date.now() + Number(process.env.DUFFEL_BUDGET_MS || 11 * 60000);
  for (const p of todo) {
    if (Date.now() > deadline) break;
    let row = null;
    for (;;) {
      row = await duffel.cheapest({ origin: p.origin, destination: p.destination, departureDate: date, returnDate: null });
      if (row !== null) break;
      // null puede ser "sin ofertas" (queda en cache) o tope local: si fue tope, esperar y reintentar.
      if (duffel.lastSkipped && duffel.lastSkipped()) { await new Promise((s) => setTimeout(s, 7500)); continue; }
      break;
    }
    r.duffelTested.push({ origin: p.origin, destination: p.destination, date, offers: Boolean(row) });
    if (row) r.withDuffel.push({ origin: p.origin, destination: p.destination, date, priceEur: row.price });
    fs.writeFileSync(FILE, JSON.stringify(recompute(r), null, 2));
  }
  recompute(r);
  r.duffelCheckedAt = new Date().toISOString();
  fs.writeFileSync(FILE, JSON.stringify(r, null, 2));
  const out = {};
  for (const o of only.length ? only : Object.keys(r.byOrigin)) out[o] = `${r.byOrigin[o].percent}→${r.byOrigin[o].percentWithDuffel}`;
  console.log(JSON.stringify({ remaining: r.withoutData.filter((p) => (!only.length || only.includes(p.origin)) && !r.duffelTested.some((t) => t.origin === p.origin && t.destination === p.destination)).length, byOrigin: out }));
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
