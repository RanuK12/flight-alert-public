'use strict';

/**
 * Capa de proveedores LLM: Groq (primario) → Mistral (fallback).
 *   complete(system, user, schema, maxTokens) -> objeto | {text} | null
 * Timeout 5 s por intento y 1 reintento (solo en errores transitorios). Si fallan los dos
 * proveedores devuelve null y el bot sigue con el menú de siempre.
 * Las claves salen solo de process.env y nunca se loguean. La IA jamás produce precios.
 */
const telemetry = require('./telemetry');
const logger = require('../../utils/logger').child('ai');

const MAX_TOKENS = 150;
const RETRIES = 1;

const PROVIDERS = [
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    get model() { return process.env.GROQ_MODEL || 'llama-3.1-8b-instant'; },
  },
  {
    name: 'mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    keyEnv: 'MISTRAL_API_KEY',
    get model() { return process.env.MISTRAL_MODEL || 'mistral-small'; },
  },
];

function timeoutMs() { return Number(process.env.AI_TIMEOUT_MS) || 5000; }

function hasKey(p) { return Boolean(String(process.env[p.keyEnv] || '').trim()); }

/** Hay al menos una clave en el entorno (si no, la función está apagada). */
function configured() { return PROVIDERS.some(hasKey); }

async function callOne(p, messages, { maxTokens = MAX_TOKENS, json = false, fetchImpl = globalThis.fetch, timeout = timeoutMs() } = {}) {
  const key = String(process.env[p.keyEnv] || '').trim();
  if (!key) { const e = new Error(`${p.name}_no_key`); e.code = 'no_key'; throw e; }
  const res = await fetchImpl(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: 0,
      max_tokens: Math.min(MAX_TOKENS, maxTokens),
      // Los modelos gpt-oss (si alguien fija GROQ_MODEL=openai/gpt-oss-*) responden 400 json_validate_failed
      // con response_format: ahí no se envía y se baja el razonamiento. El default no los usa.
      ...(/gpt-oss/.test(p.model) ? { reasoning_effort: 'low' } : (json ? { response_format: { type: 'json_object' } } : {})),
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) { const e = new Error(`${p.name}_http_${res.status}`); e.status = res.status; throw e; }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '') : '';
  const tokens = Number(data && data.usage && data.usage.total_tokens) || 0;
  return { provider: p.name, content, tokens, status: res.status };
}

/** Errores que vale la pena reintentar: red, timeout, 429 y 5xx. */
function transient(err) {
  if (!err) return false;
  if (err.code === 'no_key') return false;
  if (err.status) return err.status === 429 || err.status >= 500;
  return true;
}

function extractJson(content) {
  const m = /\{[\s\S]*\}/.exec(String(content || ''));
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (_e) { return null; }
}

/**
 * @param {string} system
 * @param {string} user
 * @param {object|null} schema  con schema → modo JSON (response_format) y devuelve el objeto; sin schema → {text}
 * @param {number} maxTokens
 * @param {{purpose?:string, call?:Function, providers?:object[], fetchImpl?:Function}} [opts]
 */
async function complete(system, user, schema, maxTokens = MAX_TOKENS, opts = {}) {
  const call = opts.call || module.exports.callOne; // vía exports: los tests pueden reemplazarlo
  const purpose = opts.purpose || 'ai';
  const list = (opts.providers || PROVIDERS).filter(hasKey);
  const json = Boolean(schema);
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      const t0 = Date.now();
      try {
        const out = await call(p, messages, { maxTokens, json, fetchImpl: opts.fetchImpl });
        const latencyMs = Date.now() - t0;
        const content = out && out.content;
        let value = null;
        if (json) {
          value = extractJson(content);
          if (!value || typeof value !== 'object' || Array.isArray(value)) value = null;
        } else {
          const text = String(content || '').trim();
          value = text ? { text } : null;
        }
        telemetry.record({ purpose, provider: p.name, latencyMs, tokens: out && out.tokens, ok: Boolean(value), fallback: i > 0 });
        if (value) return value;
        break; // respuesta vacía o sin JSON: con temperature 0 no sirve reintentar; sigue el otro proveedor
      } catch (err) {
        const latencyMs = Date.now() - t0;
        telemetry.record({ purpose, provider: p.name, latencyMs, ok: false, fallback: i > 0 });
        logger.warn('ai_provider_error', { provider: p.name, code: err.status || err.code || err.name, attempt });
        if (!transient(err)) break;
      }
    }
  }
  return null;
}

module.exports = { PROVIDERS, MAX_TOKENS, callOne, complete, configured, hasKey, extractJson };
