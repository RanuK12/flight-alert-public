'use strict';

const { ORIGINS, DESTINATIONS } = require('../../config/airports');

const IATA = new Set([...ORIGINS, ...DESTINATIONS]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const KEYS = new Set(['origin', 'destination', 'departDate', 'returnDate', 'adults', 'flexibleMonth']);

function validDate(s) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validación estricta. Devuelve {ok, value} o {ok:false, error}. Rechaza claves extra (p. ej. precios). */
const { todayART } = require('./today');

/** opts.today (YYYY-MM-DD, hoy ART por defecto): rechaza departDate anterior a hoy. */
function validate(obj, opts = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'not_object' };
  for (const k of Object.keys(obj)) if (!KEYS.has(k)) return { ok: false, error: `extra_key:${k}` };
  const origin = String(obj.origin || '').toUpperCase();
  const destination = String(obj.destination || '').toUpperCase();
  if (!IATA.has(origin)) return { ok: false, error: 'origin' };
  if (!IATA.has(destination) || destination === origin) return { ok: false, error: 'destination' };
  if (typeof obj.departDate !== 'string' || !validDate(obj.departDate)) return { ok: false, error: 'departDate' };
  if (obj.departDate < (opts.today || todayART())) return { ok: false, error: 'past' };
  let returnDate = null;
  if (obj.returnDate !== null && obj.returnDate !== undefined) {
    if (typeof obj.returnDate !== 'string' || !validDate(obj.returnDate) || obj.returnDate < obj.departDate) {
      return { ok: false, error: 'returnDate' };
    }
    returnDate = obj.returnDate;
  }
  const adults = obj.adults === undefined || obj.adults === null ? 1 : obj.adults;
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) return { ok: false, error: 'adults' };
  const value = { origin, destination, departDate: obj.departDate, returnDate, adults };
  if (obj.flexibleMonth !== undefined && obj.flexibleMonth !== null) {
    if (typeof obj.flexibleMonth !== 'string' || !MONTH.test(obj.flexibleMonth)) return { ok: false, error: 'flexibleMonth' };
    value.flexibleMonth = obj.flexibleMonth;
  }
  return { ok: true, value };
}

module.exports = { validate, IATA };
