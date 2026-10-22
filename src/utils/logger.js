'use strict';

const { redact } = require('./mask');

const RING = [];
const RING_MAX = 500;

/** Borra lo que parezca secreto o dato personal antes de guardarlo en memoria para /admin/logs. */
function scrub(line) {
  return line
    .replace(/\d{6,}:[A-Za-z0-9_-]{25,}/g, '[token]')
    .replace(/(sk|rk|pk|whsec)_(live|test)?_?[A-Za-z0-9]{8,}/g, '[stripe]')
    .replace(/APP_U[S]R-[A-Za-z0-9-]+|TEST-[A-Za-z0-9-]{20,}/g, '[mp]')
    .replace(/mongodb(\+srv)?:\/\/[^\s"]+/g, '[mongo]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[hex]')
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer [token]');
}

function remember(line) {
  RING.push(scrub(line));
  if (RING.length > RING_MAX) RING.shift();
}

function recent(n = 200) {
  return RING.slice(-Math.min(Math.max(1, n), RING_MAX));
}

function emit(level, scope, msg, meta) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta ? redact(meta) : {}),
  });
  remember(line);
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
}

function child(scope) {
  return {
    debug: (msg, meta) => emit('debug', scope, msg, meta),
    info: (msg, meta) => emit('info', scope, msg, meta),
    warn: (msg, meta) => emit('warn', scope, msg, meta),
    error: (msg, meta) => emit('error', scope, msg, meta instanceof Error ? { error: meta.message } : meta),
  };
}

module.exports = { child, recent, scrub };
