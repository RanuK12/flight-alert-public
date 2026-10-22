'use strict';

const cols = new Map();

function match(doc, filter) {
  if (!filter) return true;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') return expected.some((sub) => match(doc, sub));
    if (key === '$and') return expected.every((sub) => match(doc, sub));
    if (expected && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof Date)) {
      if ('$lt' in expected && !(doc[key] < expected.$lt)) return false;
      if ('$lte' in expected && !(doc[key] <= expected.$lte)) return false;
      if ('$gt' in expected && !(doc[key] > expected.$gt)) return false;
      if ('$gte' in expected && !(doc[key] >= expected.$gte)) return false;
      if ('$ne' in expected && doc[key] === expected.$ne) return false;
      if ('$in' in expected && !expected.$in.includes(doc[key])) return false;
      if ('$exists' in expected && ((doc[key] !== undefined) !== expected.$exists)) return false;
      if ('$lt' in expected || '$lte' in expected || '$gt' in expected || '$gte' in expected || '$ne' in expected || '$in' in expected || '$exists' in expected) {
        return true;
      }
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc, update, isInsert) {
  const next = { ...doc };
  if (isInsert && update.$setOnInsert) Object.assign(next, update.$setOnInsert);
  if (update.$set) Object.assign(next, update.$set);
  if (update.$inc) {
    for (const [key, n] of Object.entries(update.$inc)) {
      next[key] = (Number(next[key]) || 0) + n;
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

class Col {
  constructor() {
    this.docs = [];
    this.n = 1;
  }

  async create(doc) {
    const row = { ...doc, _id: doc._id || `m${this.n++}` };
    this.docs.push(row);
    return { ...row };
  }

  async findOne(filter) {
    const row = this.docs.find((doc) => match(doc, filter));
    return row ? { ...row } : null;
  }

  find(filter = {}) {
    const rows = () => this.docs.filter((doc) => match(doc, filter)).map((doc) => ({ ...doc }));
    return { lean: () => Promise.resolve(rows()) };
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((doc) => match(doc, filter)).length;
  }

  async updateOne(filter, update, opts = {}) {
    const idx = this.docs.findIndex((doc) => match(doc, filter));
    if (idx === -1) {
      if (!opts.upsert) return { matchedCount: 0, modifiedCount: 0 };
      const row = applyUpdate({ ...plainFilter(filter), _id: `m${this.n++}` }, update, true);
      this.docs.push(row);
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
    }
    this.docs[idx] = applyUpdate(this.docs[idx], update, false);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async updateMany(filter, update) {
    let n = 0;
    this.docs = this.docs.map((doc) => {
      if (!match(doc, filter)) return doc;
      n += 1;
      return applyUpdate(doc, update, false);
    });
    return { modifiedCount: n };
  }

  async findOneAndUpdate(filter, update, opts = {}) {
    const idx = this.docs.findIndex((doc) => match(doc, filter));
    if (idx === -1) {
      if (!opts.upsert) return null;
      const row = applyUpdate({ ...plainFilter(filter), _id: `m${this.n++}` }, update, true);
      this.docs.push(row);
      return { ...row };
    }
    this.docs[idx] = applyUpdate(this.docs[idx], update, false);
    return { ...this.docs[idx] };
  }

  async deleteMany(filter = {}) {
    const before = this.docs.length;
    this.docs = this.docs.filter((doc) => !match(doc, filter));
    return { deletedCount: before - this.docs.length };
  }
}

function collection(name) {
  if (!cols.has(name)) cols.set(name, new Col());
  return cols.get(name);
}

function reset() {
  cols.clear();
}

module.exports = { collection, reset, match };
