'use strict';

const clock = require('../utils/clock');

const buckets = new Map();

function key(name, id) {
  return `${name}:${id}`;
}

function tooSoon(id, windowMs = 10000) {
  const t = clock.now().getTime();
  const k = key('search', id);
  const prev = buckets.get(k) || 0;
  if (t - prev < windowMs) return true;
  buckets.set(k, t);
  return false;
}

function limited(name, id, limit, windowMs) {
  const t = clock.now().getTime();
  const k = key(name, id);
  const hits = (buckets.get(k) || []).filter((ts) => t - ts < windowMs);
  if (hits.length >= limit) {
    buckets.set(k, hits);
    return true;
  }
  hits.push(t);
  buckets.set(k, hits);
  return false;
}

function reset() {
  buckets.clear();
}

module.exports = { tooSoon, limited, reset };
