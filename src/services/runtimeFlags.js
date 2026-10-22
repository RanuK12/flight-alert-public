'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');

/** Overrides que se cambian desde /admin y viven en Mongo. Caché en memoria para leerlos sin await. */
const cache = new Map();

async function refresh() {
  const rows = await col('RuntimeFlag').find({}).lean();
  cache.clear();
  for (const r of rows) if (r.value !== null && r.value !== undefined) cache.set(r.key, r.value);
  return Object.fromEntries(cache);
}

async function set(key, value) {
  await col('RuntimeFlag').updateOne(
    { key },
    { $set: { key, value, at: clock.now().toISOString() } },
    { upsert: true },
  );
  if (value === null) cache.delete(key);
  else cache.set(key, value);
}

function get(key) {
  return cache.has(key) ? cache.get(key) : null;
}

function reset() {
  cache.clear();
}

let timer = null;
function startRefresh(everyMs = 30000) {
  if (timer) return;
  timer = setInterval(() => refresh().catch(() => {}), everyMs);
  if (timer.unref) timer.unref();
}

module.exports = { refresh, set, get, reset, startRefresh };
