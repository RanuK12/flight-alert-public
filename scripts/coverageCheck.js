'use strict';

/**
 * Chequeo manual de cobertura. No lo llama el deploy.
 * 5 orígenes × 31 destinos × 12 meses, respetando X-Rate-Limit-*.
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { ORIGINS, DESTINATIONS } = require('../src/config/airports');

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

async function main() {
  if (!process.env.TRAVELPAYOUTS_TOKEN) {
    console.log('pendiente: falta TRAVELPAYOUTS_TOKEN');
    return;
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const months = monthsAhead(12);
  const withData = [];
  const withoutData = [];
  for (const origin of ORIGINS) {
    for (const destination of DESTINATIONS) {
      let fresh = false;
      for (const month of months) {
        const res = await axios.get(`${BASE}/v2/prices/month-matrix`, {
          params: {
            origin,
            destination,
            month,
            currency: 'eur',
            token: process.env.TRAVELPAYOUTS_TOKEN,
          },
          timeout: 8000,
          headers: { 'X-Access-Token': process.env.TRAVELPAYOUTS_TOKEN },
        });
        await pace(res.headers || {}, sleep);
        const rows = (res.data && res.data.data) || [];
        const hit = rows.some((row) => {
          const at = new Date(row.found_at || 0).getTime();
          return Number(row.value) > 0 && Date.now() - at <= FRESH_MS;
        });
        if (hit) fresh = true;
      }
      const pair = { origin, destination };
      if (fresh) withData.push(pair);
      else withoutData.push(pair);
    }
  }
  const total = withData.length + withoutData.length;
  const percent = total ? Math.round((withData.length / total) * 1000) / 10 : 0;
  const report = { percent, withData, withoutData, checkedAt: new Date().toISOString() };
  console.log(JSON.stringify({ percent, without: withoutData.length, with: withData.length }));
  if (percent < 60) {
    const dir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'coverage.json'), JSON.stringify(report, null, 2));
    console.log('cobertura bajo 60: el producto ofrece solo los pares con datos');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { pace, monthsAhead };
