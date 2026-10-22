'use strict';

/**
 * Clientes LLM mínimos (Groq primario, Mistral fallback). Las claves salen
 * solo de process.env y nunca se loguean. La IA solo devuelve JSON de
 * parámetros de búsqueda: jamás precios.
 */
const MAX_TOKENS = 150;
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 4000;

const PROVIDERS = [
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
    keyEnv: 'GROQ_API_KEY',
  },
  {
    name: 'mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
    keyEnv: 'MISTRAL_API_KEY',
  },
];

async function callOne(p, messages, { maxTokens = MAX_TOKENS, fetchImpl = globalThis.fetch } = {}) {
  const key = process.env[p.keyEnv];
  if (!key) { const e = new Error(`${p.name}_no_key`); e.code = 'no_key'; throw e; }
  const res = await fetchImpl(p.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: 0,
      max_tokens: Math.min(MAX_TOKENS, maxTokens),
      // Sin response_format: con openai/gpt-oss-20b Groq responde 400 json_validate_failed.
      // El JSON se extrae del texto y se valida en schema.js.
      ...(/gpt-oss/.test(p.model) ? { reasoning_effort: 'low' } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) { const e = new Error(`${p.name}_http_${res.status}`); e.status = res.status; throw e; }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message
    ? String(data.choices[0].message.content || '') : '';
  const tokens = Number(data && data.usage && data.usage.total_tokens) || 0;
  return { provider: p.name, content, tokens, status: res.status };
}

module.exports = { PROVIDERS, MAX_TOKENS, TIMEOUT_MS, callOne };
