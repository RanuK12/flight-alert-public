'use strict';

const fs = require('fs');
const path = require('path');
const { allPairs, ORIGINS, DESTINATIONS, ORIGIN_GROUPS, EU_RETURN_HUBS, destinationsFor } = require('./airports');

const REPORT = path.join(__dirname, '..', '..', 'data', 'coverage.json');

/** COVERAGE_FILE='' (tests) apaga el filtro; sin definir usa data/coverage.json. */
function file() {
  return process.env.COVERAGE_FILE !== undefined ? process.env.COVERAGE_FILE : REPORT;
}

let cache = { file: null, mtime: 0, data: null, set: null };
function report() {
  const f = file();
  if (!f) return null;
  try {
    const mtime = fs.statSync(f).mtimeMs;
    if (cache.file !== f || cache.mtime !== mtime) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      cache = { file: f, mtime, data, set: new Set((data.withData || []).map((p) => `${p.origin}-${p.destination}`)) };
    }
    return cache.data;
  } catch {
    cache = { file: null, mtime: 0, data: null, set: null };
    return null;
  }
}

/**
 * Filtro por par, no global: con informe, solo se ofrecen los pares que tuvieron precio
 * fresco (≤48 h) en el último chequeo. Un par no medido no se ofrece (hay que medirlo antes).
 * Sin informe (dev/tests), cobertura completa.
 * Así un origen flojo (p. ej. MVD) solo muestra sus destinos con datos y no esconde los de Argentina.
 */
function pairAllowed(origin, destination) {
  const r = report();
  if (!r) return true;
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
  pairAllowed, report, allPairs, REPORT,
  destinationsAvailable, originAvailable, latamOriginsAvailable, groupsAvailable, euHubsAvailable, euOriginsAvailable,
};
