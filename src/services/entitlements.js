'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');
const flags = require('../config/flags');
const plans = require('../config/plans');
const pricing = require('../config/pricing');
const art = require('../utils/art');
const funnel = require('./funnel');
const logger = require('../utils/logger').child('entitlements');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 3 * DAY_MS;

function ent() { return col('Entitlement'); }
function routes() { return col('Route'); }
function devices() { return col('DeviceTrial'); }
function payments() { return col('Payment'); }
function notifs() { return col('Notification'); }

function idOf(id) { return String(id); }

function getSearchCap() {
  return plans.current().free.searchesPerMonth;
}

function getTrialDays() {
  return plans.current().trial.days;
}

function getProDays() {
  return plans.current().pro.days || pricing.proDays();
}

function sortByRecentEdit(list) {
  return [...list].sort((a, b) => {
    const ta = new Date(a.updatedAtIso || a.updatedAt || a.createdAt || 0).getTime() || 0;
    const tb = new Date(b.updatedAtIso || b.updatedAt || b.createdAt || 0).getTime() || 0;
    if (tb !== ta) return tb - ta;
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
}

function isExpiredRoute(route, todayIso) {
  if (!route) return false;
  if (route.flexMonth) return false;
  const end = route.returnDate || route.dateTo || route.outboundDate || route.dateFrom;
  return Boolean(end && /^\d{4}-\d{2}-\d{2}$/.test(String(end)) && String(end) < todayIso);
}

async function ensure(id) {
  const telegramUserId = idOf(id);
  const month = clock.artMonth(clock.now());
  await ent().updateOne(
    { telegramUserId },
    {
      $setOnInsert: {
        telegramUserId,
        plan: flags.isOwner(telegramUserId) ? 'owner' : 'free',
        searchesUsed: 0,
        searchMonth: month,
      },
    },
    { upsert: true },
  );
  return ent().findOne({ telegramUserId });
}

async function resetMonthIfNeeded(id) {
  const telegramUserId = idOf(id);
  const month = clock.artMonth(clock.now());
  await ensure(id);
  await ent().updateOne(
    { telegramUserId, searchMonth: { $ne: month } },
    { $set: { searchMonth: month, searchesUsed: 0 } },
  );
}

async function planOf(id) {
  if (flags.isOwner(id) || flags.isAdmin(id)) {
    const doc = await ent().findOne({ telegramUserId: idOf(id) });
    return { plan: 'owner', doc };
  }
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  if (!doc) return { plan: 'free', doc: null };
  const t = clock.now().getTime();
  if (doc.plan === 'owner') return { plan: 'owner', doc };
  if (doc.plan === 'pro') {
    if (doc.proUntil && new Date(doc.proUntil).getTime() > t) return { plan: 'pro', doc };
    if (doc.graceUntil && new Date(doc.graceUntil).getTime() > t) return { plan: 'pro', doc };
  }
  if (doc.plan === 'trial' && doc.trialEndsAt && new Date(doc.trialEndsAt).getTime() > t) {
    return { plan: 'trial', doc };
  }
  return { plan: 'free', doc };
}

function maxAlertsFor(planName) {
  const cfg = plans.current();
  if (planName === 'owner') return Infinity;
  if (planName === 'pro') return cfg.pro.maxActiveAlerts;
  if (planName === 'trial') return cfg.trial.maxActiveAlerts;
  return cfg.free.maxActiveAlerts;
}

async function activeAlertsOf(id) {
  const all = await routes().find({ telegramUserId: idOf(id), paused: false }).lean();
  return sortByRecentEdit(all.filter((r) => !r.deletedAt));
}

async function peek(id) {
  if (flags.isOwner(id)) return { ok: true, owner: true };
  await resetMonthIfNeeded(id);
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  const used = doc ? doc.searchesUsed : 0;
  const limit = getSearchCap();
  return { ok: used < limit, used, limit };
}

async function reserveSearch(id) {
  if (flags.isOwner(id)) return { ok: true, charged: false, owner: true };
  await resetMonthIfNeeded(id);
  const limit = getSearchCap();
  const doc = await ent().findOneAndUpdate(
    { telegramUserId: idOf(id), searchesUsed: { $lt: limit } },
    { $inc: { searchesUsed: 1 } },
  );
  if (!doc) return { ok: false, charged: false, limit };
  return { ok: true, charged: true, used: doc.searchesUsed, limit };
}

async function refundSearch(id) {
  if (flags.isOwner(id)) return null;
  return ent().findOneAndUpdate(
    { telegramUserId: idOf(id), searchesUsed: { $gt: 0 } },
    { $inc: { searchesUsed: -1 } },
  );
}

async function isPro(id) {
  const { plan } = await planOf(id);
  return plan === 'owner' || plan === 'pro';
}

async function canUseAlerts(id) {
  const { plan } = await planOf(id);
  if (plan !== 'free') return true;
  if (plans.isSafeMode()) return false;
  return plans.current().free.maxActiveAlerts > 0;
}

async function canCreateOrReactivate(id, { countDelta = 1 } = {}) {
  if (plans.isSafeMode()) {
    return { ok: false, status: 503, code: 'PLAN_CONFIG_UNAVAILABLE' };
  }
  const { plan } = await planOf(id);
  const activeList = await activeAlertsOf(id);
  const active = activeList.length;
  const cap = maxAlertsFor(plan);
  if (active + countDelta > cap) {
    if (plan === 'pro') {
      return { ok: false, status: 409, code: 'LIMIT_REACHED', plan, active, cap };
    }
    return { ok: false, status: 402, code: 'PAYWALL', plan, active, cap };
  }
  return { ok: true, plan, active, cap };
}

async function instantQuotaState(id) {
  const telegramUserId = idOf(id);
  const now = clock.now();
  const dayStart = art.startOfArtDay(now).toISOString();
  const { plan, doc } = await planOf(id);
  const cfg = plans.current();

  const allSent = (await notifs().find({ telegramUserId, kind: 'instant' }).lean())
    .filter((n) => n.status !== 'failed' && n.status !== 'skipped');
  const instantUsedToday = allSent.filter((n) => String(n.sentAtIso || '') > dayStart).length;

  if (plan === 'owner') {
    return {
      instantTotalMax: null,
      instantPerDayMax: flags.isAdmin(id) ? (Number(process.env.ADMIN_ALERTS_PER_DAY) || 500) : null,
      instantUsedTotal: allSent.length,
      instantUsedToday,
    };
  }
  if (plan === 'pro') {
    const rawEnv = process.env.INSTANT_ALERTS_MAX_PER_DAY;
    const hasEnv = rawEnv !== undefined && rawEnv !== null && String(rawEnv).trim() !== '' && Number.isFinite(Number(rawEnv)) && Number(rawEnv) >= 0;
    const perDay = hasEnv ? Number(rawEnv) : cfg.pro.instantPerDayMax;
    return {
      instantTotalMax: null,
      instantPerDayMax: plans.isSafeMode() ? 0 : perDay,
      instantUsedTotal: allSent.length,
      instantUsedToday,
    };
  }
  if (plan === 'trial') {
    const since = (doc && doc.trialUsedAt) || '1970-01-01T00:00:00.000Z';
    const instantUsedTotal = allSent.filter((n) => String(n.sentAtIso || '') >= since).length;
    return {
      instantTotalMax: plans.isSafeMode() ? 0 : (cfg.trial.instantTotalMax ?? null),
      instantPerDayMax: cfg.trial.instantPerDayMax ?? null,
      instantUsedTotal,
      instantUsedToday,
    };
  }
  return {
    instantTotalMax: cfg.free.instantTotalMax ?? 0,
    instantPerDayMax: 0,
    instantUsedTotal: 0,
    instantUsedToday: 0,
  };
}

function proCaps(id) {
  const n = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  if (id !== undefined && flags.isAdmin(id)) return { perMin: n('ADMIN_SEARCH_PER_MIN', 60), perDay: n('ADMIN_SEARCH_PER_DAY', 500) };
  const cfg = plans.current().pro;
  return {
    perMin: n('PRO_SEARCH_PER_MIN', cfg.searchPerMin || 10),
    perDay: n('PRO_SEARCH_PER_DAY', 60),
  };
}

async function proDayOk(id) {
  const day = art.parts(clock.now()).day;
  const doc = await ent().findOne({ telegramUserId: idOf(id) });
  const used = doc && doc.proSearchDay === day ? Number(doc.proSearchesToday) || 0 : 0;
  return used < proCaps(id).perDay;
}

async function reserveProSearch(id) {
  const day = art.parts(clock.now()).day;
  const telegramUserId = idOf(id);
  const cap = proCaps(id).perDay;
  await ensure(id);
  await ent().updateOne(
    { telegramUserId, proSearchDay: { $ne: day } },
    { $set: { proSearchDay: day, proSearchesToday: 0 } },
  );
  const r = await ent().updateOne(
    { telegramUserId, proSearchDay: day, proSearchesToday: { $lt: cap } },
    { $inc: { proSearchesToday: 1 } },
  );
  if (!r.modifiedCount) return false;
  const doc = await ent().findOne({ telegramUserId });
  if (!doc || doc.proSearchDay !== day || Number(doc.proSearchesToday) > cap) {
    await releaseProSearch(id);
    return false;
  }
  return true;
}

async function releaseProSearch(id) {
  const day = art.parts(clock.now()).day;
  await ent().updateOne(
    { telegramUserId: idOf(id), proSearchDay: day, proSearchesToday: { $gt: 0 } },
    { $inc: { proSearchesToday: -1 } },
  );
}

async function countProSearch(id) {
  return reserveProSearch(id);
}

async function startTrial(id, deviceHash) {
  if (plans.isSafeMode()) {
    return { ok: false, reason: 'plan_config_unavailable' };
  }
  const telegramUserId = idOf(id);
  await ensure(id);
  const doc = await ent().findOne({ telegramUserId });
  if (doc.trialUsedAt || doc.plan === 'pro' || doc.plan === 'owner') {
    return { ok: false, reason: 'cuenta' };
  }
  if (deviceHash) {
    const used = await devices().findOne({ deviceHash });
    if (used) return { ok: false, reason: 'dispositivo' };
  }
  const start = clock.now();
  const trialMs = getTrialDays() * DAY_MS;
  const trialEndsAt = new Date(start.getTime() + trialMs).toISOString();
  await ent().updateOne(
    { telegramUserId },
    {
      $set: {
        plan: 'trial',
        trialUsedAt: start.toISOString(),
        trialEndsAt,
        deviceHash: deviceHash || null,
        expiryNoticeAt: null,
      },
    },
  );
  if (deviceHash) {
    await devices().create({
      deviceHash,
      telegramUserId,
      usedAt: start.toISOString(),
    });
  }
  await funnel.record({ event: 'trial_start', userId: telegramUserId, plan: 'trial' });
  return { ok: true, trialEndsAt };
}

/** Reactivates billing-paused routes sorted most-recently-edited first, up to maxActiveAlerts. */
async function reactivateBillingPaused(telegramUserId) {
  const cap = maxAlertsFor('pro');
  const todayIso = art.parts(clock.now()).day;
  const all = await routes().find({ telegramUserId }).lean();
  const activeCount = all.filter((r) => !r.paused && !r.deletedAt).length;
  const budget = Math.max(0, cap - activeCount);
  if (budget <= 0) return { reactivated: 0 };

  const candidates = sortByRecentEdit(
    all.filter((r) => r.paused && r.pausedByBilling === true && !r.deletedAt && !isExpiredRoute(r, todayIso)),
  ).slice(0, budget);

  for (const r of candidates) {
    await routes().updateOne(
      { _id: r._id, telegramUserId },
      {
        $set: { paused: false, pausedByBilling: false, pausedReason: null },
        $inc: { version: 1 },
      },
    );
  }
  return { reactivated: candidates.length };
}

async function activatePro(id, provider, ref, until, _opts = {}) {
  const telegramUserId = idOf(id);
  const seen = await payments().findOne({ provider, ref });
  if (seen && seen.status !== 'pending_link') {
    const doc = await ent().findOne({ telegramUserId: seen.telegramUserId || telegramUserId });
    return { ok: true, duplicate: true, proUntil: doc && doc.proUntil };
  }
  if (seen && seen.status === 'pending_link') {
    await payments().updateOne(
      { provider, ref },
      { $set: { telegramUserId, status: 'paid' } },
    );
  } else {
    try {
      await payments().create({ provider, ref, telegramUserId, status: 'paid', paidAt: clock.now().toISOString() });
    } catch (err) {
      if (err && err.code === 11000) {
        const doc = await ent().findOne({ telegramUserId });
        return { ok: true, duplicate: true, proUntil: doc && doc.proUntil };
      }
      throw err;
    }
  }

  await ensure(id);
  const existing = await ent().findOne({ telegramUserId });
  const requestedUntil = (until instanceof Date ? until : new Date(until)).toISOString();

  // Protect manual 'comp' grants: billing webhooks cannot shorten or override their proUntil.
  const isCompProtected = existing
    && (existing.provider === 'comp' || existing.source === 'comp')
    && provider !== 'comp';
  const finalUntil = isCompProtected && existing.proUntil && existing.proUntil > requestedUntil
    ? existing.proUntil
    : requestedUntil;

  const safeMode = plans.isSafeMode();
  const patch = {
    plan: 'pro',
    proUntil: finalUntil,
    graceUntil: null,
    expiryNoticeAt: null,
    reactivationPending: safeMode,
  };
  if (!isCompProtected) {
    patch.provider = provider;
    patch.source = provider;
    patch.providerRef = ref;
  }

  await ent().updateOne({ telegramUserId }, { $set: patch });

  let reactivated = 0;
  if (!safeMode) {
    const res = await reactivateBillingPaused(telegramUserId);
    reactivated = res.reactivated;
  }
  return { ok: true, duplicate: false, proUntil: finalUntil, reactivationPending: safeMode, reactivated };
}

/** Called once PlanConfig recovers from safe mode to process reactivationPending users. */
async function flushPendingReactivations() {
  if (plans.isSafeMode()) return 0;
  const rows = await ent().find({ reactivationPending: true }).lean();
  let count = 0;
  for (const row of rows) {
    await reactivateBillingPaused(row.telegramUserId);
    await ent().updateOne({ telegramUserId: row.telegramUserId }, { $set: { reactivationPending: false } });
    count += 1;
  }
  return count;
}

/** Keeps up to `cap` most-recently-edited active alerts active, pausing only the excess with plan_limit. */
async function enforcePlanAlertLimit(telegramUserId, targetPlan = 'free') {
  const cap = Math.max(0, maxAlertsFor(targetPlan));
  const active = await activeAlertsOf(telegramUserId);
  const kept = active.slice(0, cap);
  const excess = active.slice(cap);
  for (const r of excess) {
    await routes().updateOne(
      { _id: r._id, telegramUserId },
      {
        $set: { paused: true, pausedByBilling: true, pausedReason: 'plan_limit' },
        $inc: { version: 1 },
      },
    );
  }
  return { kept, paused: excess };
}

async function pauseForBilling(telegramUserId) {
  const { paused } = await enforcePlanAlertLimit(telegramUserId, 'free');
  return paused.length;
}

async function downgrade(id, { billing = false } = {}) {
  const telegramUserId = idOf(id);
  await ensure(id);
  const cur = await ent().findOne({ telegramUserId });
  if (billing && cur && (cur.provider === 'comp' || cur.source === 'comp')) {
    return { plan: 'pro', protectedComp: true };
  }
  await enforcePlanAlertLimit(telegramUserId, 'free');
  await ent().updateOne(
    { telegramUserId },
    { $set: { plan: 'free', proUntil: null, graceUntil: null, reactivationPending: false, expiryNoticeAt: clock.now().toISOString() } },
  );
  return { plan: 'free' };
}

async function openGrace(id) {
  const telegramUserId = idOf(id);
  const graceUntil = new Date(clock.now().getTime() + GRACE_MS).toISOString();
  await ensure(id);
  const cur = await ent().findOne({ telegramUserId });
  if (!cur || !cur.proUntil) return { graceUntil: null, skipped: true };
  if (cur.provider === 'comp' || cur.source === 'comp') return { graceUntil: null, skipped: true, protectedComp: true };
  const paid = await payments().findOne({ telegramUserId, status: 'paid' });
  if (!paid) return { graceUntil: null, skipped: true };
  await ent().updateOne(
    { telegramUserId },
    { $set: { plan: 'pro', graceUntil, expiryNoticeAt: null } },
  );
  return { graceUntil };
}

async function userLang(telegramUserId) {
  const u = await col('User').findOne({ telegramUserId });
  const l = u && u.lang;
  return ['es', 'en', 'pt'].includes(l) ? l : 'es';
}

function formatEndNotice({ lang, kind, instantGotCount, kept, paused }) {
  const { t } = require('../bot/ux/i18n');
  const got = kind === 'trialOver' && instantGotCount > 0
    ? t(lang, 'endGot', { k: instantGotCount })
    : '';
  const activeStr = kept.length
    ? t(lang, 'endActive', { routes: kept.map((r) => `${r.origin}→${r.destination}`).join(', ') })
    : '';
  const pausedStr = paused.length > 0
    ? t(lang, 'endPaused', { p: paused.length })
    : '';
  const key = kind === 'trialOver' ? 'trialEnded' : (kind === 'graceOver' ? 'payLapsed' : 'proExpired');
  return t(lang, key, { got, active: activeStr, paused: pausedStr });
}

async function endAccess(doc, bot, kind) {
  const { kept, paused } = await enforcePlanAlertLimit(doc.telegramUserId, 'free');
  const noticeAt = clock.now().toISOString();
  await ent().updateOne(
    { telegramUserId: doc.telegramUserId },
    { $set: { plan: 'free', expiryNoticeAt: noticeAt, graceUntil: null, reactivationPending: false } },
  );
  let instantGotCount = 0;
  if (kind === 'trialOver') {
    const since = doc.trialUsedAt || '1970-01-01T00:00:00.000Z';
    const sentRows = (await notifs().find({ telegramUserId: doc.telegramUserId, kind: 'instant', status: 'sent' }).lean())
      .filter((n) => String(n.sentAtIso || '') >= since);
    instantGotCount = sentRows.length;
  }
  const lang = await userLang(doc.telegramUserId);
  const text = formatEndNotice({ lang, kind, instantGotCount, kept, paused });
  const chatId = doc.telegramChatId || doc.telegramUserId;
  if (bot && chatId) {
    await bot.sendMessage(chatId, text);
  }
  logger.info('acceso vencido', { telegramUserId: doc.telegramUserId, kind, pausedCount: paused.length });
}

async function expire(bot) {
  if (require('../config/flags').kill()) return { skipped: true };
  const docs = await ent().find({}).lean();
  const t = clock.now().getTime();
  let ended = 0;
  for (const doc of docs) {
    if (doc.expiryNoticeAt) continue;
    if (doc.provider === 'comp' || doc.source === 'comp') continue;
    const trialOver = doc.plan === 'trial' && doc.trialEndsAt && new Date(doc.trialEndsAt).getTime() <= t;
    const graceOver = doc.plan === 'pro' && doc.graceUntil && new Date(doc.graceUntil).getTime() <= t;
    const proOver = doc.plan === 'pro' && !doc.graceUntil && doc.proUntil && new Date(doc.proUntil).getTime() <= t;
    if (trialOver || graceOver || proOver) {
      const kind = trialOver ? 'trialOver' : (graceOver ? 'graceOver' : 'proOver');
      await endAccess(doc, bot, kind);
      ended += 1;
    }
  }
  return { ended };
}

function reportCap() {
  const v = Number(process.env.REPORT_ONDEMAND_PER_DAY);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

async function reserveOnDemandReport(id) {
  const day = art.parts(clock.now()).day;
  const telegramUserId = idOf(id);
  const cap = reportCap();
  await ensure(id);
  await ent().updateOne(
    { telegramUserId, reportDay: { $ne: day } },
    { $set: { reportDay: day, reportsToday: 0 } },
  );
  const r = await ent().updateOne(
    { telegramUserId, reportDay: day, reportsToday: { $lt: cap } },
    { $inc: { reportsToday: 1 } },
  );
  if (!r.modifiedCount) return false;
  const doc = await ent().findOne({ telegramUserId });
  if (!doc || doc.reportDay !== day || Number(doc.reportsToday) > cap) {
    await releaseOnDemandReport(id);
    return false;
  }
  return true;
}

async function releaseOnDemandReport(id) {
  const day = art.parts(clock.now()).day;
  await ent().updateOne(
    { telegramUserId: idOf(id), reportDay: day, reportsToday: { $gt: 0 } },
    { $inc: { reportsToday: -1 } },
  );
}

function proUntilFromNow(interval = 'monthly') {
  const days = interval === 'annual' ? 365 : getProDays();
  return new Date(clock.now().getTime() + days * DAY_MS);
}

const api = {
  idOf,
  isPro,
  planOf,
  maxAlertsFor,
  activeAlertsOf,
  proCaps,
  proDayOk,
  countProSearch,
  reserveProSearch,
  releaseProSearch,
  DAY_MS,
  ensure,
  peek,
  reserveSearch,
  refundSearch,
  canUseAlerts,
  canCreateOrReactivate,
  instantQuotaState,
  startTrial,
  activatePro,
  flushPendingReactivations,
  enforcePlanAlertLimit,
  downgrade,
  openGrace,
  expire,
  pauseForBilling,
  proUntilFromNow,
  reportCap,
  reserveOnDemandReport,
  releaseOnDemandReport,
};

let searchCapOverride = null;
Object.defineProperty(api, 'SEARCH_CAP', {
  enumerable: true,
  configurable: true,
  get: () => (searchCapOverride != null ? searchCapOverride : getSearchCap()),
  set: (v) => {
    const n = Number(v);
    searchCapOverride = v == null || !Number.isFinite(n) || n === getSearchCap() ? null : n;
  },
});
Object.defineProperty(api, 'TRIAL_DAYS', { enumerable: true, get: getTrialDays });
Object.defineProperty(api, 'PRO_DAYS', { enumerable: true, get: getProDays });

module.exports = api;
