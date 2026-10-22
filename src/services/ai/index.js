'use strict';

/**
 * Búsqueda en lenguaje natural (Pro/admin). Reglas primero; la IA solo como
 * fallback, y solo convierte texto a parámetros {origin, destination, ...}.
 * Nunca produce precios: los precios salen siempre de runSearch.
 */
const providers = require('./providers');
const { validate } = require('./schema');
const { parseRules } = require('./rules');
const flags = require('../../config/flags');
const clock = require('../../utils/clock');
const logger = require('../../utils/logger').child('ai');

const DAILY_CAP = 20;
const CACHE_MAX = 500;
const cache = new Map();
const usage = new Map(); // userId -> {day, n}
const stats = { calls: 0, tokens: 0, errors: 0, cacheHits: 0, fallbacks: 0, capped: 0, byProvider: {} };

function enabled() {
  const v = String(process.env.AI_ENABLED || '').trim().toLowerCase();
  return v === 'true' || v === 'on' || v === '1' || v === 'yes';
}

function isAdmin(id) {
  if (id === undefined || id === null || id === '') return false;
  const ids = String(process.env.ADMIN_TELEGRAM_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(id)) || flags.isOwner(id);
}

async function allowed(id, isProFn) {
  if (isAdmin(id)) return true;
  const isPro = isProFn || require('../entitlements').isPro;
  return Boolean(await isPro(id));
}

function normalize(text) {
  return String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 300);
}

function today() { return clock.now().toISOString().slice(0, 10); }

function takeQuota(id) {
  const d = today();
  const u = usage.get(String(id));
  const n = u && u.day === d ? u.n : 0;
  if (n >= DAILY_CAP) return false;
  usage.set(String(id), { day: d, n: n + 1 });
  return true;
}

function prompt(text) {
  const t = today();
  return [
    {
      role: 'system',
      content: 'Convertís pedidos de vuelos a JSON. Hoy es ' + t + '. Respondé SOLO un objeto JSON con claves '
        + 'origin, destination (códigos IATA de 3 letras), departDate (YYYY-MM-DD), returnDate (YYYY-MM-DD o null), '
        + 'adults (entero), y opcional flexibleMonth (YYYY-MM). Buenos Aires=EZE, Córdoba=COR. Nunca incluyas precios.',
    },
    { role: 'user', content: text },
  ];
}

function extractJson(content) {
  const m = /\{[\s\S]*\}/.exec(String(content || ''));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_e) { return null; }
}

/** Llama Groq y, si falla, Mistral. Inyectable para tests (opts.call). */
async function askLlm(text, opts = {}) {
  const call = opts.call || providers.callOne;
  const list = opts.providers || providers.PROVIDERS;
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    try {
      stats.calls += 1;
      if (i > 0) stats.fallbacks += 1;
      const out = await call(p, prompt(text), { maxTokens: providers.MAX_TOKENS });
      stats.tokens += Number(out.tokens) || 0;
      stats.byProvider[p.name] = (stats.byProvider[p.name] || 0) + 1;
      const v = validate(extractJson(out.content));
      if (v.ok) return { ok: true, value: v.value, provider: p.name };
      return { ok: false, reason: 'invalid', provider: p.name };
    } catch (err) {
      stats.errors += 1;
      logger.warn('llm falló', { provider: p.name, code: err.status || err.code || err.name });
    }
  }
  return { ok: false, reason: 'providers_down' };
}

/**
 * @returns {Promise<{ok:boolean, source?:'rules'|'ai'|'cache', value?:object, reason?:string}>}
 */
async function parse(userId, text, opts = {}) {
  const r = parseRules(text);
  if (r) {
    const v = validate(r);
    if (v.ok) return { ok: true, source: 'rules', value: v.value };
  }
  if (!enabled()) return { ok: false, reason: 'disabled' };
  if (!(await allowed(userId, opts.isPro))) return { ok: false, reason: 'not_pro' };
  const key = normalize(text);
  if (!key) return { ok: false, reason: 'empty' };
  if (cache.has(key)) { stats.cacheHits += 1; return { ok: true, source: 'cache', value: { ...cache.get(key) } }; }
  if (!takeQuota(userId)) { stats.capped += 1; return { ok: false, reason: 'daily_cap' }; }
  const out = await askLlm(key, opts);
  if (!out.ok) return out;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, out.value);
  return { ok: true, source: 'ai', value: { ...out.value } };
}

function health() {
  return { enabled: enabled(), dailyCap: DAILY_CAP, cacheSize: cache.size, ...stats, byProvider: { ...stats.byProvider } };
}

function _reset() {
  cache.clear(); usage.clear();
  Object.assign(stats, { calls: 0, tokens: 0, errors: 0, cacheHits: 0, fallbacks: 0, capped: 0, byProvider: {} });
}

module.exports = { parse, askLlm, enabled, isAdmin, allowed, normalize, health, DAILY_CAP, _reset };
