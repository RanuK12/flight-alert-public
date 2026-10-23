'use strict';

/**
 * Chequeo manual de cobertura. No lo llama el deploy.
 * Todos los pares de allPairs() (LATAM→Europa y la vuelta Europa→LATAM) × COVERAGE_MONTHS
 * meses (4 por defecto), respetando X-Rate-Limit-*. Escribe siempre data/coverage.json
 * con `tested`, `withData` y el % por origen; el producto ofrece solo pares con datos.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { allPairs } = require('../src/config/airports');

const BASE = 'https://api.travelpayouts.com';
const FRESH_MS = 48 * 60 * 60 * 1000;

function monthsAhead(n = 12) {
  const out = [];
  const now = new Date();
  for (let i = 0; i < n; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

async function pace(headers, sleep) {
  const remaining = Number(
    headers['x-rate-limit-remaining']
    ?? headers['x-ratelimit-remaining']
    ?? headers['x-rate-limit-remaining'.toLowerCase()],
  );
  if (remaining !== 0) return;
  const resetRaw = Number(headers['x-rate-limit-reset'] || headers['retry-after'] || 1);
  const ms = resetRaw > 1e9 ? (resetRaw * 1000 - Date.now()) : resetRaw * 1000;
  await sleep(Math.max(0, ms));
}

async function getWithRetry(fn, sleep, tries = 8) {
  for (let i = 0; ; i += 1) {
    try { return await fn(); } catch (err) {
      if (i + 1 >= tries) throw err;
      const is429 = err.response && err.response.status === 429;
      await sleep(is429 ? 15000 * (i + 1) : 2000 * (i + 1));
    }
  }
}

async function main() {
  if (!process.env.TRAVELPAYOUTS_TOKEN) {
    console.log('pendiente: falta TRAVELPAYOUTS_TOKEN');
    return;
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const months = monthsAhead(Number(process.env.COVERAGE_MONTHS) || 4);
  const withData = [];
  const withoutData = [];
  const only = (process.env.COVERAGE_ORIGINS || '').split(',').filter(Boolean);
  const queue = allPairs().filter((p) => !only.length || only.includes(p.origin));
  const workers = Math.max(1, Number(process.env.COVERAGE_CONCURRENCY) || 2);
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const { origin, destination } = next;
      let fresh = false;
      for (const month of months) {
        const res = await getWithRetry(() => axios.get(`${BASE}/v2/prices/month-matrix`, {
          params: {
            origin,
            destination,
            month,
            currency: 'eur',
            token: process.env.TRAVELPAYOUTS_TOKEN,
          },
          timeout: 8000,
          headers: { 'X-Access-Token': process.env.TRAVELPAYOUTS_TOKEN },
        }), sleep);
        await pace(res.headers || {}, sleep);
        const rows = (res.data && res.data.data) || [];
        const hit = rows.some((row) => {
          const at = new Date(row.found_at || 0).getTime();
          return Number(row.value) > 0 && Date.now() - at <= FRESH_MS;
        });
        if (hit) { fresh = true; break; }
      }
      const pair = { origin, destination };
      if (fresh) withData.push(pair);
      else withoutData.push(pair);
    }
  }
  await Promise.all(Array.from({ length: workers }, worker));
  const key = (p) => `${p.origin}-${p.destination}`;
  withData.sort((a, b) => key(a).localeCompare(key(b)));
  withoutData.sort((a, b) => key(a).localeCompare(key(b)));
  const total = withData.length + withoutData.length;
  const percent = total ? Math.round((withData.length / total) * 1000) / 10 : 0;
  const byOrigin = {};
  for (const p of [...withData, ...withoutData]) byOrigin[p.origin] = byOrigin[p.origin] || { with: 0, total: 0 };
  for (const p of withData) byOrigin[p.origin].with += 1;
  for (const p of [...withData, ...withoutData]) byOrigin[p.origin].total += 1;
  for (const o of Object.keys(byOrigin)) byOrigin[o].percent = Math.round((byOrigin[o].with / byOrigin[o].total) * 1000) / 10;
  const tested = [...withData, ...withoutData];
  const report = { percent, months, freshHours: 48, byOrigin, tested, withData, withoutData, checkedAt: new Date().toISOString() };
  console.log(JSON.stringify({ percent, without: withoutData.length, with: withData.length, byOrigin }));
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(process.env.COVERAGE_OUT || path.join(dir, 'coverage.json'), JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { pace, monthsAhead };
