'use strict';

/**
 * Telemetría de la IA: contadores en memoria + una línea de log por llamada.
 * Solo proveedor, latencia, tokens y cache_hit. Nunca el texto del usuario ni de la respuesta.
 */
const logger = require('../../utils/logger').child('ai');

const stats = { calls: 0, tokens: 0, errors: 0, cacheHits: 0, fallbacks: 0, capped: 0, byProvider: {} };

function record({ purpose, provider, latencyMs, tokens = 0, cacheHit = false, ok = true, fallback = false }) {
  if (cacheHit) stats.cacheHits += 1;
  else {
    stats.calls += 1;
    stats.tokens += Number(tokens) || 0;
    if (provider) stats.byProvider[provider] = (stats.byProvider[provider] || 0) + 1;
    if (fallback) stats.fallbacks += 1;
  }
  if (!ok) stats.errors += 1;
  logger.info('ai_call', {
    purpose,
    provider: provider || null,
    latency_ms: Math.round(Number(latencyMs) || 0),
    // OJO: el logger enmascara cualquier clave que contenga "token"; por eso no se llama tokens.
    usage_total: Number(tokens) || 0,
    cache_hit: Boolean(cacheHit),
    ok: Boolean(ok),
  });
}

function capped(purpose) {
  stats.capped += 1;
  logger.info('ai_capped', { purpose });
}

function snapshot() {
  return { ...stats, byProvider: { ...stats.byProvider } };
}

function reset() {
  Object.assign(stats, { calls: 0, tokens: 0, errors: 0, cacheHits: 0, fallbacks: 0, capped: 0, byProvider: {} });
}

module.exports = { record, capped, snapshot, reset };
