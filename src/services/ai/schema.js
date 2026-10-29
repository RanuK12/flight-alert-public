'use strict';

const { ORIGINS, DESTINATIONS, pairOk } = require('../../config/airports');

const IATA = new Set([...ORIGINS, ...DESTINATIONS]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const KEYS = new Set(['origin', 'destination', 'departDate', 'returnDate', 'adults', 'flexibleMonth']);

/** Nombre de ciudad/alias (p. ej. "Córdoba", "madrid") → IATA, solo si es inequívoco. */
function resolveCode(raw) {
  const up = String(raw || '').trim().toUpperCase();
  if (IATA.has(up)) return up;
  const { PLACES, norm } = require('../../bot/ux/places');
  const q = norm(raw);
  if (!q) return up;
  for (const code of [...ORIGINS, ...DESTINATIONS]) {
    const p = PLACES[code];
    if (!p) continue;
    if ([p.city, p.airport, ...(p.alias || [])].map(norm).includes(q)) return code; // EZE antes que BUE
  }
  return up;
}

function addYear(s) { return `${Number(s.slice(0, 4)) + 1}${s.slice(4)}`; }

function validDate(s) {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Validación estricta. Devuelve {ok, value} o {ok:false, error}. Rechaza claves extra (p. ej. precios). */
const { todayART } = require('./today');

/**
 * opts.today (YYYY-MM-DD, hoy ART por defecto): rechaza departDate anterior a hoy.
 * opts.strict: sin reinterpretar fechas (nada de "próximo año" ni "hoy" automático): lo que no cierra se rechaza.
 */
function validate(obj, opts = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'not_object' };
  for (const k of Object.keys(obj)) if (!KEYS.has(k)) return { ok: false, error: `extra_key:${k}` };
  const today = opts.today || todayART();
  const origin = resolveCode(obj.origin);
  const destination = resolveCode(obj.destination);
  obj = { ...obj };
  if (!opts.strict) {
    // Mes sin día: el día 1 del mes (o hoy si es el mes actual).
    if ((obj.departDate === undefined || obj.departDate === null) && typeof obj.flexibleMonth === 'string' && MONTH.test(obj.flexibleMonth)) {
      obj.departDate = `${obj.flexibleMonth}-01`;
    }
    // "en marzo" interpretado en el año en curso ya pasado: la próxima ocurrencia.
    if (typeof obj.departDate === 'string' && validDate(obj.departDate) && obj.departDate < today
      && obj.departDate.slice(0, 7) < today.slice(0, 7) && validDate(addYear(obj.departDate)) && addYear(obj.departDate) >= today) {
      obj.departDate = addYear(obj.departDate);
      if (typeof obj.returnDate === 'string' && validDate(obj.returnDate)) obj.returnDate = addYear(obj.returnDate);
      if (typeof obj.flexibleMonth === 'string' && MONTH.test(obj.flexibleMonth)) obj.flexibleMonth = obj.departDate.slice(0, 7);
    }
    if (typeof obj.departDate === 'string' && obj.departDate.slice(0, 7) === today.slice(0, 7) && obj.departDate < today
      && typeof obj.flexibleMonth === 'string') obj.departDate = today;
  }
  if (!IATA.has(origin)) return { ok: false, error: 'origin' };
  if (!IATA.has(destination) || destination === origin || !pairOk(origin, destination)) return { ok: false, error: 'destination' };
  if (typeof obj.departDate !== 'string' || !validDate(obj.departDate)) return { ok: false, error: 'departDate' };
  if (obj.departDate < today) return { ok: false, error: 'past' };
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

const LLM_KEYS = new Set(['origen', 'destino', 'fecha_ida', 'fecha_vuelta', 'flex_dias']);
const CODE = /^[A-Za-z]{3}$/;
const MAX_FLEX = 7;

/** Forma de la respuesta que se le pide al modelo (P1). Se usa como `schema` de providers.complete. */
const NL_SEARCH = { name: 'nl_search', keys: [...LLM_KEYS] };

/**
 * Validación estricta de la salida del modelo (P1):
 * {origen:IATA|null, destino:IATA|null, fecha_ida:YYYY-MM-DD|null, fecha_vuelta:YYYY-MM-DD|null, flex_dias:0-7}.
 * Todo null = el texto no era una búsqueda ('not_search'); faltan datos = 'incomplete' (se le vuelve a preguntar).
 * IATA contra la tabla local, fechas >= hoy (ART), vuelta >= ida. Sin reinterpretar nada.
 * @returns {{ok:true,value:object}|{ok:false,error:string}}
 */
function fromLlm(obj, opts = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'not_object' };
  for (const k of Object.keys(obj)) if (!LLM_KEYS.has(k)) return { ok: false, error: `extra_key:${k}` };
  const { origen, destino, fecha_ida: ida, fecha_vuelta: vuelta } = obj;
  const nil = (v) => v === null || v === undefined;
  if (nil(origen) && nil(destino) && nil(ida)) return { ok: false, error: 'not_search' };
  if (nil(origen) || nil(destino) || nil(ida)) return { ok: false, error: 'incomplete' };
  if (typeof origen !== 'string' || typeof destino !== 'string' || !CODE.test(origen) || !CODE.test(destino)) {
    return { ok: false, error: 'iata' };
  }
  if (typeof ida !== 'string' || (!nil(vuelta) && typeof vuelta !== 'string')) return { ok: false, error: 'date' };
  if (!IATA.has(origen.toUpperCase()) || !IATA.has(destino.toUpperCase())) return { ok: false, error: 'iata' };
  let flexDays = 0;
  if (!nil(obj.flex_dias)) {
    if (!Number.isInteger(obj.flex_dias) || obj.flex_dias < 0 || obj.flex_dias > MAX_FLEX) return { ok: false, error: 'flex_dias' };
    flexDays = obj.flex_dias;
  }
  const v = validate(
    { origin: origen.toUpperCase(), destination: destino.toUpperCase(), departDate: ida, returnDate: nil(vuelta) ? null : vuelta },
    { today: opts.today, strict: true },
  );
  if (!v.ok) return v;
  return { ok: true, value: { ...v.value, flexDays } };
}

module.exports = { validate, fromLlm, NL_SEARCH, MAX_FLEX, IATA, resolveCode };
