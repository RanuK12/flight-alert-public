'use strict';

/**
 * P2: consejo de UNA línea sobre una ruta con precio. El modelo solo recibe datos calculados por código
 * (precio, mínimo y promedio del historial, y una señal) y no puede devolver cifras: si la respuesta
 * trae algún dígito o moneda, se descarta. Caché por (ruta, día ART), 24 h, compartida entre alertas
 * e informe de las 21:00. Solo Pro/admin, y detrás de AI_ENABLED + AI_ADVICE_ENABLED.
 */
const clock = require('../../utils/clock');
const logger = require('../../utils/logger').child('ai');
const telemetry = require('./telemetry');
const { todayART } = require('./today');

const TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const MAX_TOKENS = 60;
const WAIT_MS = 8000;
const cache = new Map();   // `${routeKey}|${día ART}|${lang}` -> { text, exp }
const pending = new Map(); // misma clave -> promesa en vuelo (no duplica llamadas)

const LANG_NAME = { es: 'español rioplatense', en: 'English', pt: 'português' };

function ai() { return require('./index'); }

/** Señal calculada por código a partir del historial. */
function signalOf(price, min, avg) {
  if (price <= min * 1.02) return 'near_min';
  if (price <= avg * 0.95) return 'below_avg';
  if (price >= avg * 1.05) return 'above_avg';
  return 'near_avg';
}

function system(lang) {
  return 'Das un consejo de UNA sola línea (máximo 18 palabras) a alguien que sigue el precio de un vuelo. '
    + `Escribí en ${LANG_NAME[lang] || LANG_NAME.es}. Recibís un JSON con la ruta y una señal: `
    + 'near_min = está cerca del mínimo reciente, below_avg = por debajo del promedio, near_avg = en el promedio, '
    + 'above_avg = por encima del promedio. Basate solo en la señal. '
    + 'PROHIBIDO escribir números, cifras, porcentajes, monedas o fechas; no prometas que el precio va a subir o bajar. '
    + 'Sin comillas, sin emojis, sin saltos de línea.';
}

const BAD = /\d|[€$£%]|\b(?:eur|euros?|usd|ars|dolares|dólares|pesos|dollars?)\b|https?:|www\./i;

/** Una línea, sin números ni monedas ni enlaces. */
function clean(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["'`“”]+|["'`“”]+$/g, '').trim();
  if (t.length < 8 || t.length > 160) return null;
  if (BAD.test(t)) return null;
  return t;
}

function statsOf(price, hist) {
  const prices = (hist || []).map((h) => Number(h.price != null ? h.price : h)).filter((n) => n > 0);
  if (prices.length < 2 || !(price > 0)) return null;
  const min = Math.min(...prices, price);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  return { min, avg };
}

/**
 * @param {string|number} userId
 * @param {{routeKey:string, origin:string, destination:string, price:number, min:number, avg:number, lang?:string}} d
 * @returns {Promise<string|null>} la línea, o null (apagado, no Pro, sin cupo, proveedores caídos, salida inválida)
 */
async function adviceFor(userId, d, opts = {}) {
  const A = ai();
  if (!A.adviceEnabled()) return null;
  if (!(d && d.routeKey && d.price > 0 && d.min > 0 && d.avg > 0)) return null;
  if (!(await A.allowed(userId, opts.isPro))) return null;
  const lang = LANG_NAME[d.lang] ? d.lang : 'es';
  const now = clock.now();
  const key = `${d.routeKey}|${todayART(now)}|${lang}`;
  const hit = cache.get(key);
  if (hit && hit.exp > now.getTime()) {
    telemetry.record({ purpose: 'advice', cacheHit: true });
    return hit.text;
  }
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const signal = signalOf(d.price, d.min, d.avg);
    const g = await A.guarded(userId, 'advice', {
      system: system(lang),
      user: JSON.stringify({ ruta: `${d.origin}-${d.destination}`, senal: signal }),
      schema: null,
      maxTokens: MAX_TOKENS,
    }, opts);
    if (!g.ok) return null;
    const text = clean(g.value.text);
    if (!text) {
      logger.warn('ai_invalid_output', { purpose: 'advice', error: 'rejected' });
      return null;
    }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { text, exp: now.getTime() + TTL_MS });
    return text;
  })().finally(() => pending.delete(key));
  pending.set(key, job);
  // Un alerta o un informe no esperan más que esto; el trabajo en vuelo sigue y deja el resultado en caché.
  const wait = new Promise((resolve) => { const t = setTimeout(() => resolve(null), opts.waitMs || WAIT_MS); if (t.unref) t.unref(); });
  return Promise.race([job, wait]);
}

/** Alertas instantáneas: el consejo de una ruta con su historial. Nunca lanza. */
async function forAlert(route, flight, now, opts = {}) {
  try {
    if (!ai().adviceEnabled()) return null;
    const priceHistory = require('../priceHistory');
    const hist = await priceHistory.history(route, now, 30);
    const s = statsOf(Number(flight.price), hist);
    if (!s) return null;
    return await adviceFor(route.telegramUserId, {
      routeKey: priceHistory.routeKey(route),
      origin: route.origin,
      destination: route.destination,
      price: Number(flight.price),
      lang: route.lang,
      ...s,
    }, opts);
  } catch (err) {
    logger.warn('advice_alert', { error: err.message });
    return null;
  }
}

/** Informe de las 21:00: agrega `advice` a las tarjetas con precio y historial. Nunca lanza. */
async function attachToReport(userId, report, histByKey, lang, opts = {}) {
  try {
    if (!ai().adviceEnabled()) return report;
    if (!(await ai().allowed(userId, opts.isPro))) return report;
    for (const c of report.full || []) {
      if (c.state === 'empty' || !c.routeKey) continue;
      const s = statsOf(c.price, histByKey.get(c.routeKey) || []);
      if (!s) continue;
      const [origin, destination] = String(c.title).split(' \u2192 ');
      c.advice = await adviceFor(userId, { routeKey: c.routeKey, origin, destination, price: c.price, lang, ...s }, opts);
    }
  } catch (err) {
    logger.warn('advice_report', { error: err.message });
  }
  return report;
}

function _reset() { cache.clear(); pending.clear(); }

module.exports = { adviceFor, forAlert, attachToReport, clean, signalOf, statsOf, _reset, TTL_MS, MAX_TOKENS };
