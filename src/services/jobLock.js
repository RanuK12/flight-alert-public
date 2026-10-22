'use strict';

const crypto = require('crypto');
const { col } = require('../database');
const clock = require('../utils/clock');

/** Id de esta instancia del proceso: cada arranque es un dueño distinto. */
const INSTANCE = `${process.env.RENDER_INSTANCE_ID || 'local'}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

function locks() { return col('JobLock'); }

async function ensure(name) {
  try {
    await locks().updateOne(
      { name },
      { $setOnInsert: { name, owner: null, until: 0, lastWindow: null, lastRunAt: null } },
      { upsert: true },
    );
  } catch (err) {
    if (err && err.code !== 11000) throw err; // otra instancia lo creó en el mismo momento
  }
}

/**
 * Lease con TTL. Devuelve true si esta instancia tiene el lock.
 * Un lease vencido (proceso muerto o dormido) se puede tomar.
 */
async function acquire(name, ttlMs, owner = INSTANCE) {
  await ensure(name);
  const now = clock.now().getTime();
  const doc = await locks().findOneAndUpdate(
    { name, $or: [{ until: { $lt: now } }, { owner }] },
    { $set: { owner, until: now + ttlMs } },
  );
  return Boolean(doc);
}

async function release(name, owner = INSTANCE) {
  await locks().updateOne({ name, owner }, { $set: { until: 0, owner: null } });
}

async function state(name) {
  await ensure(name);
  return locks().findOne({ name });
}

async function markDone(name, windowKey, owner = INSTANCE) {
  await locks().updateOne(
    { name, owner },
    { $set: { lastWindow: windowKey, lastRunAt: clock.now().toISOString() } },
  );
}

module.exports = { acquire, release, state, markDone, INSTANCE };
