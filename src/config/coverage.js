'use strict';

const fs = require('fs');
const path = require('path');
const { allPairs } = require('./airports');

const REPORT = path.join(__dirname, '..', '..', 'data', 'coverage.json');

function report() {
  try {
    return JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Si el último chequeo manual está por debajo del 60 %,
 * solo se ofrecen los pares que tenían precio.
 * Sin informe, se ofrece la cobertura completa.
 */
function pairAllowed(origin, destination) {
  const r = report();
  if (!r || typeof r.percent !== 'number' || r.percent >= 60) return true;
  return (r.withData || []).some((p) => p.origin === origin && p.destination === destination);
}

module.exports = { pairAllowed, report, allPairs, REPORT };
