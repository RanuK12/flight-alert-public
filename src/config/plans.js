'use strict';

/**
 * PlanConfig loader & validator.
 * Reads PLAN_LIMITS_JSON (env) + PlanConfig DB override (refreshed every 60s),
 * preserving the last valid config on invalid writes, or degrading safely to
 * source='safe' (create/reactivate returns 503 PLAN_CONFIG_UNAVAILABLE without
 * consuming trial, instant alerts pause with reason plan_config_missing, and
 * digest + existing alerts keep running).
 */

const { col } = require('../database');
const clock = require('../utils/clock');
const logger = require('../utils/logger').child('plans');

const REFRESH_MS = 60 * 1000;
const LOG_COOLDOWN_MS = 60 * 60 * 1000;

const SAFE_CONFIG = Object.freeze({
  checkIntervalMin: 180,
  free: Object.freeze({ maxActiveAlerts: 1, digestEnabled: true, instantTotalMax: 0, searchesPerMonth: 10 }),
  trial: Object.freeze({ maxActiveAlerts: 3, digestEnabled: true, days: 7, instantTotalMax: null, instantPerDayMax: null }),
  pro: Object.freeze({ maxActiveAlerts: 30, digestEnabled: true, instantPerDayMax: 5, days: 30, searchPerMin: 10, searchPerDay: 200 }),
  safeMode: true,
});

function posInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function nonNegInt(v) {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function parseTrialTotalEnv(env = process.env) {
  const raw = env.INSTANT_ALERTS_TRIAL_MAX_TOTAL;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseTrialPerDayEnv(env = process.env) {
  const raw = env.INSTANT_ALERTS_TRIAL_MAX_PER_DAY;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function validatePlanObject(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'PLAN_LIMITS_JSON must be an object' };
  }
  const f = raw.free;
  const tr = raw.trial;
  const p = raw.pro;
  if (!f || !tr || !p) return { ok: false, error: 'missing free, trial, or pro section' };

  if (!nonNegInt(f.maxActiveAlerts) || typeof f.digestEnabled !== 'boolean') {
    return { ok: false, error: 'invalid free plan limits' };
  }
  const fInstant = f.instantTotalMax === undefined ? 0 : f.instantTotalMax;
  const fSearch = f.searchesPerMonth ?? f.monthlySearches ?? 10;
  if (!nonNegInt(fInstant) || !posInt(fSearch)) {
    return { ok: false, error: 'invalid free instantTotalMax or searchesPerMonth' };
  }

  if (!nonNegInt(tr.maxActiveAlerts) || typeof tr.digestEnabled !== 'boolean' || !posInt(tr.days ?? 7)) {
    return { ok: false, error: 'invalid trial plan limits' };
  }
  const trDaily = tr.instantPerDayMax === undefined ? null : tr.instantPerDayMax;
  if (trDaily !== null && !nonNegInt(trDaily)) {
    return { ok: false, error: 'invalid trial.instantPerDayMax' };
  }
  const trTotal = tr.instantTotalMax === undefined ? null : tr.instantTotalMax;
  if (trTotal !== null && !nonNegInt(trTotal)) {
    return { ok: false, error: 'invalid trial.instantTotalMax' };
  }

  if (!posInt(p.maxActiveAlerts) || typeof p.digestEnabled !== 'boolean' || !nonNegInt(p.instantPerDayMax ?? 5)) {
    return { ok: false, error: 'invalid pro plan limits' };
  }
  const proDays = p.days ?? p.proDays ?? 30;
  if (!posInt(proDays)) return { ok: false, error: 'invalid pro.days' };

  const intervalMin = raw.checkIntervalMin === undefined ? 180 : raw.checkIntervalMin;
  if (!posInt(intervalMin)) return { ok: false, error: 'invalid checkIntervalMin' };

  return {
    ok: true,
    config: {
      checkIntervalMin: intervalMin,
      safeMode: false,
      free: {
        maxActiveAlerts: f.maxActiveAlerts,
        digestEnabled: f.digestEnabled,
        instantTotalMax: fInstant,
        searchesPerMonth: fSearch,
      },
      trial: {
        maxActiveAlerts: tr.maxActiveAlerts,
        digestEnabled: tr.digestEnabled,
        days: tr.days ?? 7,
        instantTotalMax: trTotal,
        instantPerDayMax: trDaily,
      },
      pro: {
        maxActiveAlerts: p.maxActiveAlerts,
        digestEnabled: p.digestEnabled,
        instantPerDayMax: p.instantPerDayMax ?? 5,
        days: proDays,
        searchPerMin: posInt(p.searchPerMin) ? p.searchPerMin : 10,
        searchPerDay: posInt(p.searchPerDay) ? p.searchPerDay : 200,
      },
    },
  };
}

let state = {
  source: 'safe',
  ok: false,
  config: SAFE_CONFIG,
  error: 'not_loaded',
  lastLogAt: 0,
  lastEnvRaw: undefined,
};
let timer = null;

function logSafeError(errMsg) {
  const nowMs = clock.now().getTime();
  if (nowMs - state.lastLogAt >= LOG_COOLDOWN_MS) {
    state.lastLogAt = nowMs;
    logger.error('plan_config_unavailable', { error: errMsg });
  }
}

function loadFromEnv(env = process.env) {
  const raw = env.PLAN_LIMITS_JSON;
  state.lastEnvRaw = raw;
  if (!raw || !String(raw).trim()) {
    return { ok: false, error: 'PLAN_LIMITS_JSON missing' };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `PLAN_LIMITS_JSON invalid JSON: ${err.message}` };
  }
  return validatePlanObject(parsed);
}

function syncFromEnvIfNeeded(env = process.env) {
  const raw = env.PLAN_LIMITS_JSON;
  if (state.lastEnvRaw === raw) return;
  if (state.source === 'db') {
    state.lastEnvRaw = raw;
    return;
  }
  const envRes = loadFromEnv(env);
  if (envRes.ok) {
    state.source = 'env';
    state.ok = true;
    state.config = envRes.config;
    state.error = null;
  } else {
    state.source = 'safe';
    state.ok = false;
    state.config = SAFE_CONFIG;
    state.error = envRes.error;
    logSafeError(envRes.error);
  }
}

async function refreshFromDb() {
  try {
    const doc = await col('PlanConfig').findOne({ key: 'active' });
    if (doc && doc.plans) {
      const check = validatePlanObject(doc.plans);
      if (check.ok) {
        state.source = 'db';
        state.ok = true;
        state.config = check.config;
        state.error = null;
        return { source: 'db', ok: true };
      }
      logger.warn('invalid DB PlanConfig ignored; preserving last valid config', { error: check.error });
      return { source: state.source, ok: state.ok, invalidDb: check.error };
    }
  } catch (err) {
    logger.warn('PlanConfig DB refresh failed', { error: err.message });
  }
  const envRes = loadFromEnv(process.env);
  if (envRes.ok) {
    state.source = 'env';
    state.ok = true;
    state.config = envRes.config;
    state.error = null;
  } else if (state.source !== 'db') {
    state.source = 'safe';
    state.ok = false;
    state.config = SAFE_CONFIG;
    state.error = envRes.error;
    logSafeError(envRes.error);
  }
  return { source: state.source, ok: state.ok };
}

function reload(env = process.env) {
  state.lastEnvRaw = undefined;
  state.source = 'safe';
  const res = loadFromEnv(env);
  if (res.ok) {
    state.source = 'env';
    state.ok = true;
    state.config = res.config;
    state.error = null;
  } else {
    state.source = 'safe';
    state.ok = false;
    state.config = SAFE_CONFIG;
    state.error = res.error;
    logSafeError(res.error);
  }
  return current();
}

function withRuntimeTrialCaps(cfg) {
  const envTotal = parseTrialTotalEnv(process.env);
  const envDaily = parseTrialPerDayEnv(process.env);
  return {
    ...cfg,
    trial: {
      ...cfg.trial,
      instantTotalMax: envTotal !== null ? envTotal : cfg.trial.instantTotalMax,
      instantPerDayMax: envDaily !== null ? envDaily : cfg.trial.instantPerDayMax,
    },
  };
}

function current() {
  syncFromEnvIfNeeded(process.env);
  return withRuntimeTrialCaps(state.config);
}

function isSafeMode() {
  syncFromEnvIfNeeded(process.env);
  return !state.ok || state.source === 'safe';
}

function health() {
  syncFromEnvIfNeeded(process.env);
  return {
    ok: state.ok,
    source: state.source,
    ...(state.error ? { error: state.error } : {}),
  };
}

function startRefresh(ms = REFRESH_MS) {
  if (timer) return timer;
  refreshFromDb().catch(() => {});
  timer = setInterval(() => { refreshFromDb().catch(() => {}); }, ms);
  if (timer.unref) timer.unref();
  return timer;
}

function stopRefresh() {
  if (timer) clearInterval(timer);
  timer = null;
}

function resetForTest() {
  stopRefresh();
  state = {
    source: 'safe',
    ok: false,
    config: SAFE_CONFIG,
    error: 'not_loaded',
    lastLogAt: 0,
    lastEnvRaw: undefined,
  };
}

module.exports = {
  SAFE_CONFIG,
  REFRESH_MS,
  validatePlanObject,
  parseTrialTotalEnv,
  parseTrialPerDayEnv,
  reload,
  refreshFromDb,
  current,
  isSafeMode,
  health,
  startRefresh,
  stopRefresh,
  resetForTest,
};
