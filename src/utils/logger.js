'use strict';

const { redact } = require('./mask');

function emit(level, scope, msg, meta) {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    scope,
    msg,
    ...(meta ? redact(meta) : {}),
  });
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

module.exports = { child };
