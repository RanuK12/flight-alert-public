'use strict';

/**
 * callback_data versionado: v1|<flujo>|<paso>|k=v;k=v
 * Telegram corta en 64 bytes, así que encode() falla antes de mandar algo más largo.
 */
const VERSION = 'v1';
const MAX = 64;
const FLOWS = new Set(['b', 'a', 'm', 'i', 'p', 's']);

function encode(flow, step, fields = {}) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  const out = [VERSION, flow, step].concat(parts.length ? [parts.join(';')] : []).join('|');
  if (Buffer.byteLength(out, 'utf8') > MAX) throw new Error(`callback_data de ${Buffer.byteLength(out)} bytes: ${out}`);
  return out;
}

/** Devuelve { ok, flow, step, fields } o { ok:false, stale:true } si es de otra versión o de los botones viejos. */
function decode(data) {
  const raw = String(data || '');
  if (raw === 'noop') return { ok: true, noop: true };
  const parts = raw.split('|');
  if (parts[0] !== VERSION || !FLOWS.has(parts[1]) || !parts[2]) {
    return { ok: false, stale: /^v\d+\|/.test(raw) || /^(route|alerts):/.test(raw) };
  }
  const fields = {};
  if (parts[3]) {
    for (const kv of parts[3].split(';')) {
      const i = kv.indexOf('=');
      if (i > 0) fields[kv.slice(0, i)] = kv.slice(i + 1);
    }
  }
  return { ok: true, flow: parts[1], step: parts[2], fields };
}

module.exports = { encode, decode, MAX, VERSION };
