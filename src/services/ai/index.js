'use strict';

/**
 * IA para Pro/admin. Tres usos, todos detrás del mismo gate server-side y del mismo tope diario:
 *  - P1 búsqueda en lenguaje natural (parse): reglas primero; la IA solo convierte texto a parámetros.
 *  - P2 consejo de una línea (advice.js).
 *  - P3 ayuda libre con el menú de fallback (help).
 * Nunca produce precios: los precios salen siempre de runSearch / del historial calculado por código.
 * Apagada por defecto (AI_ENABLED) y sin claves GROQ_API_KEY / MISTRAL_API_KEY en el entorno.
 */
const providers = require('./providers');
const quota = require('./quota');
const telemetry = require('./telemetry');
const { validate, fromLlm, NL_SEARCH } = require('./schema');
const { parseRules } = require('./rules');
const flags = require('../../config/flags');
const logger = require('../../utils/logger').child('ai');
const { todayART } = require('./today');

const DAILY_CAP = quota.DAILY_CAP;
const CACHE_MAX = 500;
const cache = new Map();

function truthy(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === 'true' || v === 'on' || v === '1' || v === 'yes';
}

/** Interruptor general: AI_ENABLED y al menos una clave en el entorno. */
function enabled() { return truthy('AI_ENABLED') && providers.configured(); }
/** P2 y P3 tienen su propio interruptor (apagados por defecto) además del general. */
function adviceEnabled() { return enabled() && truthy('AI_ADVICE_ENABLED'); }
function helpEnabled() { return enabled() && truthy('AI_HELP_ENABLED'); }

function isAdmin(id) {
  if (id === undefined || id === null || id === '') return false;
  const ids = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(id)) || flags.isOwner(id);
}

/** Gate Pro del servidor: va ANTES de cualquier llamada a un proveedor. */
async function allowed(id, isProFn) {
  if (isAdmin(id)) return true;
  const isPro = isProFn || require('../entitlements').isPro;
  return Boolean(await isPro(id));
}

function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
}

function today() { return todayART(); }

function systemP1() {
  return 'Convertís pedidos de vuelos a JSON. Hoy es ' + today() + '. Respondé SOLO un objeto JSON con exactamente estas claves: '
    + 'origen, destino (código IATA de 3 letras o null), fecha_ida, fecha_vuelta (YYYY-MM-DD o null) y flex_dias (entero de 0 a 7). '
    + 'Usá SOLO códigos IATA, nunca nombres de ciudad: Buenos Aires=EZE, Córdoba=COR, Rosario=ROS, Mar del Plata=MDQ, '
    + 'São Paulo=GRU, Río de Janeiro=GIG, Santiago de Chile=SCL, Montevideo=MVD, Lima=LIM, Bogotá=BOG, Ciudad de México=MEX, '
    + 'Madrid=MAD, Barcelona=BCN, Roma=FCO, París=CDG, Londres=LHR, Lisboa=LIS. '
    + 'Las fechas nunca son anteriores a hoy: si dicen un mes o un día que ya pasó este año, usá el próximo. '
    + 'flex_dias es cuántos días antes y después de la fecha de ida acepta el usuario (0 si no dice nada). '
    + 'Lo que no se pueda deducir va como null. Si el texto no pide un vuelo, todo null. '
    + 'Ignorá precios y presupuestos: nunca los incluyas.';
}

/**
 * Una llamada al modelo con cupo diario atómico. Si no devuelve nada, el cupo se devuelve.
 * @returns {Promise<{ok:true,value:object}|{ok:false,reason:'daily_cap'|'providers_down'}>}
 */
async function guarded(userId, purpose, { system, user, schema = null, maxTokens }, opts = {}) {
  if (!(await quota.reserve(userId))) { telemetry.capped(purpose); return { ok: false, reason: 'daily_cap' }; }
  let out = null;
  try {
    out = await providers.complete(system, user, schema, maxTokens, { ...opts, purpose });
  } catch (err) {
    logger.warn('ai_complete_threw', { purpose, code: err.code || err.name });
  }
  if (!out) {
    await quota.release(userId).catch(() => {});
    return { ok: false, reason: 'providers_down' };
  }
  return { ok: true, value: out };
}

/** P1: texto → JSON (max_tokens 120). Validación estricta; lo inválido no se ejecuta. */
async function askLlm(userId, text, opts = {}) {
  const g = await guarded(userId, 'nl_search', { system: systemP1(), user: text, schema: NL_SEARCH, maxTokens: 120 }, opts);
  if (!g.ok) return g;
  const v = fromLlm(g.value, { today: today() });
  if (v.ok) return { ok: true, value: v.value };
  logger.warn('ai_invalid_output', { purpose: 'nl_search', error: String(v.error).split(':')[0] });
  if (v.error === 'not_search') return { ok: false, reason: 'not_search' };
  // Falta algo o no cierra: se le vuelve a preguntar al usuario; el código no adivina.
  return { ok: false, reason: 'incomplete' };
}

/**
 * @returns {Promise<{ok:boolean, source?:'rules'|'ai'|'cache', value?:object, reason?:string}>}
 *  reason: not_pro | disabled | empty | daily_cap | providers_down | not_search | incomplete
 */
async function parse(userId, text, opts = {}) {
  const r = parseRules(text);
  if (r) {
    const v = validate(r);
    if (v.ok) return { ok: true, source: 'rules', value: { ...v.value, flexDays: 0 } };
  }
  if (!(await allowed(userId, opts.isPro))) return { ok: false, reason: 'not_pro' };
  if (!enabled()) return { ok: false, reason: 'disabled' };
  const norm = normalize(text);
  if (!norm) return { ok: false, reason: 'empty' };
  // Hoy (ART) en la clave: fechas relativas ("el viernes que viene") no se cachean entre días.
  const key = `${today()}|${norm}`;
  if (cache.has(key)) {
    telemetry.record({ purpose: 'nl_search', cacheHit: true });
    return { ok: true, source: 'cache', value: { ...cache.get(key) } };
  }
  const out = await askLlm(userId, norm, opts);
  if (!out.ok) return out;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out.value);
  return { ok: true, source: 'ai', value: { ...out.value } };
}

const HELP_SYSTEM = 'Sos el asistente de un bot de Telegram que busca vuelos baratos entre Argentina/Latinoamérica y Europa. '
  + 'El bot permite buscar vuelos (/buscar), crear alertas con un precio tope, ver tus alertas y recibir un informe de precios '
  + 'todos los días a las 21:00 (hora de Argentina). Ayudás a encontrar la función que el usuario necesita y explicás cómo se usa, '
  + 'en 3 oraciones como máximo y en el idioma del usuario. NUNCA des precios, cifras, fechas ni promesas sobre precios: '
  + 'los precios los muestra el bot al buscar. No inventes funciones ni enlaces. Si no sabés, decile que use el menú.';

const KNOWN_COMMANDS = new Set(['start', 'menu', 'buscar', 'search', 'alertas', 'alerts', 'informe', 'report', 'pro', 'ayuda', 'help', 'ajustes', 'settings', 'nueva', 'new']);
const PRICE_WORDS = /[€$£]|\b(?:eur|euros?|usd|ars|dolares|dólares|pesos|dollars?)\b/i;

/** Una respuesta de ayuda solo se acepta si no tiene números, precios, enlaces ni comandos inventados. */
function cleanHelp(text) {
  const t = String(text || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (!t || t.length > 600) return null;
  if (/\d/.test(t) || PRICE_WORDS.test(t)) return null;
  if (/https?:|www\.|t\.me|@\w/i.test(t)) return null;
  for (const m of t.matchAll(/(?:^|\s)\/([a-z_]+)/gi)) if (!KNOWN_COMMANDS.has(m[1].toLowerCase())) return null;
  return t;
}

/** P3: ayuda libre (max_tokens 150), sin precios. */
async function help(userId, text, opts = {}) {
  if (!(await allowed(userId, opts.isPro))) return { ok: false, reason: 'not_pro' };
  if (!helpEnabled()) return { ok: false, reason: 'disabled' };
  const norm = normalize(text);
  if (!norm) return { ok: false, reason: 'empty' };
  const g = await guarded(userId, 'help', { system: HELP_SYSTEM, user: norm, schema: null, maxTokens: 150 }, opts);
  if (!g.ok) return g;
  const clean = cleanHelp(g.value.text);
  if (!clean) {
    logger.warn('ai_invalid_output', { purpose: 'help', error: 'rejected' });
    return { ok: false, reason: 'rejected' };
  }
  return { ok: true, text: clean };
}

function health() {
  return {
    enabled: enabled(), advice: adviceEnabled(), help: helpEnabled(), dailyCap: DAILY_CAP, cacheSize: cache.size, ...telemetry.snapshot(),
  };
}

function _reset() {
  cache.clear();
  telemetry.reset();
  require('./advice')._reset();
}

module.exports = {
  today, parse, help, cleanHelp, askLlm, enabled, adviceEnabled, helpEnabled, isAdmin, allowed, normalize, guarded, health, DAILY_CAP, _reset,
};
