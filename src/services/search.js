'use strict';

const crypto = require('crypto');
const flags = require('../config/flags');
const clock = require('../utils/clock');
const { col } = require('../database');
const travelpayouts = require('../providers/travelpayouts');
const entitlements = require('./entitlements');
const rateLimit = require('./rateLimit');
const { sortFlights } = require('./sortFlights');
const copy = require('../bot/copy');

const DAY_MS = 24 * 60 * 60 * 1000;

function queryHash(query) {
  const raw = [
    String(query.origin || '').toUpperCase(),
    String(query.destination || '').toUpperCase(),
    query.departureDate || '',
    query.returnDate || '',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function recentDup(id, query) {
  const hash = queryHash(query);
  const rows = await col('SearchLog').find({ telegramUserId: String(id), queryHash: hash }).lean();
  const limit = clock.now().getTime() - DAY_MS;
  return rows.some((row) => new Date(row.at).getTime() >= limit);
}

async function remember(id, query) {
  await col('SearchLog').create({
    telegramUserId: String(id),
    queryHash: queryHash(query),
    at: clock.now().toISOString(),
  });
}

async function runSearch(id, query) {
  if (flags.kill()) return { status: 503, text: copy.maintenance };
  if (!flags.search()) return { status: 403, text: copy.searchOff };
  const pro = !flags.isOwner(id) && await entitlements.isPro(id);
  if (!pro && rateLimit.tooSoon(id)) {
    return { status: 429, text: copy.wait, charged: false };
  }
  if (await recentDup(id, query)) {
    const results = sortFlights(await travelpayouts.search(query));
    return { status: 200, results, charged: false, duplicate: true };
  }
  const owner = flags.isOwner(id);
  if (pro) {
    const caps = entitlements.proCaps();
    if (rateLimit.limited('pro-min', String(id), caps.perMin, 60 * 1000)) {
      return { status: 429, text: copy.proCapMinute, charged: false, proCap: 'minute' };
    }
    if (!(await entitlements.proDayOk(id))) {
      return { status: 429, text: copy.proCapDay(caps.perDay), charged: false, proCap: 'day' };
    }
    const results = sortFlights(await travelpayouts.search(query));
    if (results.length) {
      await entitlements.countProSearch(id);
      await remember(id, query);
    }
    return { status: 200, results, charged: false, pro: true };
  }
  if (!owner) {
    const gate = await entitlements.peek(id);
    if (!gate.ok) return { status: 402, text: copy.paywall, paywall: true, charged: false };
  }
  const results = sortFlights(await travelpayouts.search(query));
  if (results.length === 0) {
    return { status: 200, results, charged: false };
  }
  if (!owner) {
    const reserved = await entitlements.reserveSearch(id);
    if (!reserved.ok) return { status: 402, text: copy.paywall, paywall: true, charged: false };
  }
  await remember(id, query);
  return { status: 200, results, charged: !owner };
}

module.exports = { runSearch, queryHash };
