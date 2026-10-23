'use strict';

const fs = require('fs');
const path = require('path');
const { allPairs, ORIGINS, DESTINATIONS, ORIGIN_GROUPS, EU_RETURN_HUBS, destinationsFor } = require('./airports');

const REPORT = path.join(__dirname, '..', '..', 'data', 'coverage.json');

const MIN_ORIGIN_PERCENT = 60;
/** Fallback sin informe (fail-closed): solo Argentina → Europa, la ruta histórica. */
const FALLBACK_ORIGINS = (ORIGIN_GROUPS.find((g) => g.country === 'AR') || { codes: ['EZE'] }).codes;

/** Ruta del informe. COVERAGE_FILE='off' desactiva el filtro (solo tests de UI ajenos a cobertura). */
function file() {
  return process.env.COVERAGE_FILE || REPORT;
}
function disabled() {
  return process.env.COVERAGE_FILE === 'off';
}

let cache = { file: null, mtime: 0, data: null, set: null };
function report() {
  const f = file();
  try {
    const mtime = fs.statSync(f).mtimeMs;
    if (cache.file !== f || cache.mtime !== mtime) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      const min = Number(data.minOriginPercent) || MIN_ORIGIN_PERCENT;
      const okOrigin = (o) => data.byOrigin && data.byOrigin[o] && data.byOrigin[o].percent >= min;
      cache = { file: f, mtime, data, set: new Set((data.withData || []).filter((p) => okOrigin(p.origin)).map((p) => `${p.origin}-${p.destination}`)) };
    }
    return cache.data;
  } catch {
    cache = { file: null, mtime: 0, data: null, set: null };
    return null;
  }
}

/**
 * Umbral prometido: un origen se ofrece solo si ≥60 % de sus destinos tuvo precio fresco (≤48 h)
 * en el último chequeo, y dentro de ese origen solo los pares que tuvieron datos.
 * Los orígenes argentinos de main quedan siempre completos (grandfathered).
 * Sin informe legible: fail-closed, solo Argentina → Europa.
 */
/** Orígenes de main (AR↔EU): siempre se ofrecen completos, como antes del PR. El umbral es solo para lo nuevo. */
const GRANDFATHERED_ORIGINS = ['EZE', 'COR', 'MDQ', 'ROS', 'BUE'];

function pairAllowed(origin, destination) {
  if (disabled()) return true;
  if (GRANDFATHERED_ORIGINS.includes(origin) && DESTINATIONS.includes(destination)) return true;
  const r = report();
  if (!r) return FALLBACK_ORIGINS.includes(origin) && DESTINATIONS.includes(destination);
  return cache.set.has(`${origin}-${destination}`);
}

function destinationsAvailable(origin) {
  return destinationsFor(origin).filter((d) => pairAllowed(origin, d));
}

function originAvailable(origin) {
  return destinationsAvailable(origin).length > 0;
}

/** Orígenes LATAM con al menos un destino con datos. */
function latamOriginsAvailable() {
  return ORIGINS.filter(originAvailable);
}

function groupsAvailable() {
  return ORIGIN_GROUPS
    .map((g) => ({ ...g, codes: g.codes.filter(originAvailable) }))
    .filter((g) => g.codes.length);
}

function euHubsAvailable() {
  return EU_RETURN_HUBS.filter(originAvailable);
}

function euOriginsAvailable() {
  return DESTINATIONS.filter(originAvailable);
}

module.exports = {
  pairAllowed, report, MIN_ORIGIN_PERCENT, FALLBACK_ORIGINS, GRANDFATHERED_ORIGINS, allPairs, REPORT,
  destinationsAvailable, originAvailable, latamOriginsAvailable, groupsAvailable, euHubsAvailable, euOriginsAvailable,
};
