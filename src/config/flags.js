'use strict';

const FEATURES = [
  'FEATURE_SEARCH',
  'FEATURE_ALERTS',
  'FEATURE_PAYMENTS_STARS',
  'FEATURE_PAYMENTS_MP',
  'FEATURE_PAYMENTS_STRIPE',
  'FEATURE_CHANNELS',
  'FEATURE_INSTANT_ALERTS',
  'FEATURE_REPORT_PDF',
];

function on(name) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
}

function runtime(key) {
  try { return require('../services/runtimeFlags').get(key); } catch (_e) { return null; }
}

function kill() {
  if (runtime('kill') === 'on') return true;
  return String(process.env.PUBLIC_KILL_SWITCH || '').trim().toLowerCase() === 'on';
}

function any() {
  return FEATURES.some((name) => on(name));
}

function owners() {
  return String(process.env.OWNER_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOwner(id) {
  if (id === undefined || id === null || id === '') return false;
  return owners().includes(String(id));
}

/** Admins: solo desde la env ADMIN_TELEGRAM_IDS (coma). Nunca desde la DB ni el repo. */
function admins() {
  return String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAdmin(id) {
  if (id === undefined || id === null || id === '') return false;
  return admins().includes(String(id));
}

/** IDs que no cuentan en métricas ni revenue (admins + owners). */
function staffIds() {
  return [...new Set([...admins(), ...owners()])];
}

module.exports = {
  FEATURES,
  admins,
  isAdmin,
  staffIds,
  on,
  kill,
  any,
  owners,
  isOwner,
  search: () => on('FEATURE_SEARCH'),
  alerts: () => on('FEATURE_ALERTS'),
  stars: () => on('FEATURE_PAYMENTS_STARS'),
  mp: () => on('FEATURE_PAYMENTS_MP'),
  stripe: () => on('FEATURE_PAYMENTS_STRIPE'),
  channels: () => on('FEATURE_CHANNELS'),
  instantAlerts: () => {
    const o = runtime('instantAlerts');
    if (o === 'on') return true;
    if (o === 'off') return false;
    return on('FEATURE_INSTANT_ALERTS');
  },
};
