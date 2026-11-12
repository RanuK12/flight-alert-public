'use strict';

const fs = require('fs');
const path = require('path');

const cols = new Map();
const MODELS_DIR = path.join(__dirname, 'models');

function getClock() {
  try {
    return require('../utils/clock').now();
  } catch {
    return new Date();
  }
}

function getModel(name) {
  const file = path.join(MODELS_DIR, `${name}.js`);
  if (!fs.existsSync(file)) return null;
  try {
    return require(file);
  } catch {
    return null;
  }
}

function hasTimestamps(name) {
  const Model = getModel(name);
  if (!Model || !Model.schema || !Model.schema.options) return true;
  return Model.schema.options.timestamps !== false;
}

function coerceAndValidate(name, doc, presentKeys) {
  if (process.env.MEMORY_SCHEMA_AUDIT !== '1') return doc;
  const Model = getModel(name);
  if (!Model || !Model.schema) return doc;
  const schema = Model.schema;
  const strictDoc = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === '_id' || k === 'createdAt' || k === 'updatedAt' || k === '__v') {
      strictDoc[k] = v;
      continue;
    }
    const top = k.includes('.') ? k.split('.')[0] : null;
    if (schema.path(k) || schema.nested[k] || (top && schema.path(top) && schema.path(top).instance === 'Mixed')) {
      strictDoc[k] = v;
    }
  }
  const modelDoc = structuredClone(strictDoc);
  delete modelDoc._id;
  const instance = new Model(modelDoc);
  const pathsToValidate = (presentKeys || Object.keys(strictDoc))
    .filter((k) => k !== '_id' && k !== 'createdAt' && k !== 'updatedAt' && k !== '__v' && schema.path(k));
  if (pathsToValidate.length) {
    const err = instance.validateSync(pathsToValidate);
    if (err) throw err;
  }
  const out = { ...strictDoc };
  const keys = Object.keys(out);
  for (const p of Object.keys(schema.paths)) {
    if (p === '_id' || p === '__v') continue;
    if (schema.paths[p] && schema.paths[p].instance === 'Mixed') continue;
    if (keys.some((k) => k.startsWith(`${p}.`))) continue;
    if (out[p] === undefined && instance[p] !== undefined && p !== 'id') {
      out[p] = instance[p];
    }
  }
  return out;
}

function dupError(indexName, key) {
  const err = new Error(`E11000 duplicate key error collection: memory index: ${indexName} dup key: ${JSON.stringify(key)}`);
  err.code = 11000;
  err.index = indexName;
  err.keyPattern = key;
  return err;
}

function checkUniques(name, docs, candidate, ignoreId) {
  const others = docs.filter((d) => String(d._id) !== String(ignoreId));
  if (name === 'Payment' && candidate.provider && candidate.ref) {
    if (others.some((d) => d.provider === candidate.provider && d.ref === candidate.ref)) {
      throw dupError('provider_ref_unique', { provider: candidate.provider, ref: candidate.ref });
    }
  }
  if (name === 'StarCharge' && candidate.chargeId) {
    if (others.some((d) => d.chargeId === candidate.chargeId)) {
      throw dupError('chargeId_1', { chargeId: candidate.chargeId });
    }
  }
  if ((name === 'StarRefund' || name === 'StarCredit') && candidate.chargeId) {
    if (others.some((d) => d.chargeId === candidate.chargeId)) {
      throw dupError('chargeId_1', { chargeId: candidate.chargeId });
    }
  }
  if (name === 'PlanConfig' && candidate.key) {
    if (others.some((d) => d.key === candidate.key)) {
      throw dupError('key_1', { key: candidate.key });
    }
  }
  if (name === 'MarketPrice' && candidate.routeKey && candidate.obsDate) {
    if (others.some((d) => d.routeKey === candidate.routeKey && d.obsDate === candidate.obsDate)) {
      throw dupError('market_price_route_obs_unique', { routeKey: candidate.routeKey, obsDate: candidate.obsDate });
    }
  }
  if (name === 'IdempotencyRecord' && candidate.telegramUserId && candidate.method && candidate.path && candidate.key) {
    if (others.some((d) => (
      d.telegramUserId === candidate.telegramUserId
      && d.method === candidate.method
      && d.path === candidate.path
      && d.key === candidate.key
    ))) {
      throw dupError('idempotency_unique', { telegramUserId: candidate.telegramUserId, key: candidate.key });
    }
  }
  if (name === 'BroadcastSend' && candidate.campaignKey && candidate.telegramUserId) {
    if (others.some((d) => d.campaignKey === candidate.campaignKey && d.telegramUserId === candidate.telegramUserId)) {
      throw dupError('broadcast_campaign_user_unique', { campaignKey: candidate.campaignKey, telegramUserId: candidate.telegramUserId });
    }
  }
  if (name === 'FunnelEvent') {
    if ((candidate.event === 'trial_start' || candidate.event === 'first_cheap_alert') && candidate.userHash) {
      if (others.some((d) => d.userHash === candidate.userHash && d.event === candidate.event)) {
        throw dupError('funnel_user_once_event', { userHash: candidate.userHash, event: candidate.event });
      }
    }
    if (candidate.event === 'pro_paid' && typeof candidate.subscriptionId === 'string' && candidate.subscriptionId) {
      if (others.some((d) => d.event === 'pro_paid' && d.subscriptionId === candidate.subscriptionId)) {
        throw dupError('funnel_pro_paid_sub_unique', { event: 'pro_paid', subscriptionId: candidate.subscriptionId });
      }
    }
  }
}

function match(doc, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((sub) => match(doc, sub));
    if (key === '$and') return expected.every((sub) => match(doc, sub));
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      let hasOp = false;
      if ('$lt' in expected) { hasOp = true; if (!(doc[key] < expected.$lt)) return false; }
      if ('$lte' in expected) { hasOp = true; if (!(doc[key] <= expected.$lte)) return false; }
      if ('$gt' in expected) { hasOp = true; if (!(doc[key] > expected.$gt)) return false; }
      if ('$gte' in expected) { hasOp = true; if (!(doc[key] >= expected.$gte)) return false; }
      if ('$ne' in expected) { hasOp = true; if (doc[key] === expected.$ne) return false; }
      if ('$in' in expected) { hasOp = true; if (!expected.$in.includes(doc[key])) return false; }
      if ('$nin' in expected) { hasOp = true; if (expected.$nin.includes(doc[key])) return false; }
      if ('$exists' in expected) { hasOp = true; if ((doc[key] !== undefined) !== expected.$exists) return false; }
      if ('$type' in expected) {
        hasOp = true;
        if (expected.$type === 'string' && typeof doc[key] !== 'string') return false;
      }
      if (hasOp) return true;
    }
    if (expected === null && doc[key] === undefined) return true;
    return doc[key] === expected;
  });
}

function applyUpdate(doc, update, isInsert, now, withTs = true) {
  const next = { ...doc };
  if (withTs) {
    if (isInsert && !next.createdAt) next.createdAt = now;
    next.updatedAt = now;
  }
  if (isInsert && update.$setOnInsert) Object.assign(next, update.$setOnInsert);
  if (update.$set) Object.assign(next, update.$set);
  if (update.$inc) {
    for (const [key, n] of Object.entries(update.$inc)) {
      next[key] = (Number(next[key]) || 0) + n;
    }
  }
  if (update.$min) {
    for (const [key, v] of Object.entries(update.$min)) {
      if (next[key] === undefined || next[key] === null || v < next[key]) next[key] = v;
    }
  }
  if (update.$max) {
    for (const [key, v] of Object.entries(update.$max)) {
      if (next[key] === undefined || next[key] === null || v > next[key]) next[key] = v;
    }
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) delete next[key];
  }
  return next;
}

function plainFilter(filter) {
  const base = {};
  for (const [key, value] of Object.entries(filter || {})) {
    if (value && typeof value === 'object' && !(value instanceof Date)) continue;
    base[key] = value;
  }
  return base;
}

function compareSort(a, b, spec) {
  for (const [field, dir] of Object.entries(spec || {})) {
    const va = a[field];
    const vb = b[field];
    const na = va instanceof Date ? va.getTime() : va;
    const nb = vb instanceof Date ? vb.getTime() : vb;
    if (na === nb) continue;
    if (na === undefined || na === null) return dir >= 0 ? -1 : 1;
    if (nb === undefined || nb === null) return dir >= 0 ? 1 : -1;
    if (na < nb) return dir >= 0 ? -1 : 1;
    return dir >= 0 ? 1 : -1;
  }
  return 0;
}

class Col {
  constructor(name) {
    this.name = name;
    this.docs = [];
    this.n = 1;
  }

  async create(doc) {
    const now = getClock();
    const withTs = hasTimestamps(this.name);
    const raw = withTs
      ? { ...doc, _id: doc._id || `m${this.n++}`, createdAt: doc.createdAt || now, updatedAt: doc.updatedAt || now }
      : { ...doc, _id: doc._id || `m${this.n++}` };
    const validated = coerceAndValidate(this.name, raw, Object.keys(doc));
    checkUniques(this.name, this.docs, validated, null);
    this.docs.push(validated);
    return { ...validated };
  }

  findOne(filter) {
    const p = Promise.resolve().then(() => {
      const row = this.docs.find((doc) => match(doc, filter));
      return row ? { ...row } : null;
    });
    p.lean = () => p;
    return p;
  }

  find(filter = {}) {
    let sortSpec = null;
    let limitNum = null;
    const exec = () => {
      let rows = this.docs.filter((doc) => match(doc, filter)).map((doc) => ({ ...doc }));
      if (sortSpec) rows.sort((a, b) => compareSort(a, b, sortSpec));
      if (Number.isFinite(limitNum) && limitNum >= 0) rows = rows.slice(0, limitNum);
      return rows;
    };
    const q = {
      sort(spec) { sortSpec = spec; return q; },
      limit(n) { limitNum = n; return q; },
      lean: () => Promise.resolve(exec()),
    };
    return q;
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((doc) => match(doc, filter)).length;
  }

  async updateOne(filter, update, opts = {}) {
    const now = getClock();
    const withTs = hasTimestamps(this.name);
    const idx = this.docs.findIndex((doc) => match(doc, filter));
    if (idx === -1) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const next = applyUpdate({ ...plainFilter(filter), _id: `m${this.n++}` }, update, true, now, withTs);
      const validated = coerceAndValidate(this.name, next, Object.keys(next));
      checkUniques(this.name, this.docs, validated, null);
      this.docs.push(validated);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    const next = applyUpdate(this.docs[idx], update, false, now, withTs);
    const touched = new Set([
      ...Object.keys(update.$set || {}),
      ...Object.keys(update.$inc || {}),
      ...Object.keys(update.$min || {}),
      ...Object.keys(update.$max || {}),
    ]);
    const validated = coerceAndValidate(this.name, next, [...touched]);
    checkUniques(this.name, this.docs, validated, this.docs[idx]._id);
    this.docs[idx] = validated;
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter, update) {
    const now = getClock();
    const withTs = hasTimestamps(this.name);
    let n = 0;
    const updated = [];
    for (const doc of this.docs) {
      if (!match(doc, filter)) {
        updated.push(doc);
        continue;
      }
      n += 1;
      const next = applyUpdate(doc, update, false, now, withTs);
      updated.push(coerceAndValidate(this.name, next, Object.keys(update.$set || {})));
    }
    this.docs = updated;
    return { modifiedCount: n };
  }

  async findOneAndUpdate(filter, update, opts = {}) {
    const now = getClock();
    const withTs = hasTimestamps(this.name);
    let idx = -1;
    if (opts.sort) {
      const candidates = this.docs
        .map((doc, i) => ({ doc, i }))
        .filter(({ doc }) => match(doc, filter))
        .sort((a, b) => compareSort(a.doc, b.doc, opts.sort));
      if (candidates.length) idx = candidates[0].i;
    } else {
      idx = this.docs.findIndex((doc) => match(doc, filter));
    }
    if (idx === -1) {
      if (!opts.upsert) return null;
      const row = applyUpdate({ ...plainFilter(filter), _id: `m${this.n++}` }, update, true, now, withTs);
      const validated = coerceAndValidate(this.name, row, Object.keys(row));
      checkUniques(this.name, this.docs, validated, null);
      this.docs.push(validated);
      return opts.new === false ? null : { ...validated };
    }
    const before = { ...this.docs[idx] };
    const next = applyUpdate(this.docs[idx], update, false, now, withTs);
    const validated = coerceAndValidate(this.name, next, Object.keys(update.$set || {}));
    checkUniques(this.name, this.docs, validated, before._id);
    this.docs[idx] = validated;
    if (opts.new === false) return before;
    return { ...validated };
  }

  async deleteOne(filter = {}) {
    const idx = this.docs.findIndex((doc) => match(doc, filter));
    if (idx === -1) return { deletedCount: 0 };
    this.docs.splice(idx, 1);
    return { deletedCount: 1 };
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => !match(doc, filter));
    return { deletedCount: before - this.docs.length };
  }
}

function collection(name) {
  if (!cols.has(name)) cols.set(name, new Col(name));
  return cols.get(name);
}

function reset() {
  cols.clear();
}

module.exports = { collection, reset, match };
