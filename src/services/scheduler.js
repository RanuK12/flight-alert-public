'use strict';

const clock = require('../utils/clock');
const art = require('../utils/art');
const jobLock = require('./jobLock');
const logger = require('../utils/logger').child('scheduler');

const MIN_MS = 60 * 1000;

function num(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/** Ventana diaria a una hora ART: la última ocurrencia <= now. */
function dailyAt(hour) {
  return (now) => {
    let at = art.atArtHour(now, hour);
    if (at.getTime() > now.getTime()) at = new Date(at.getTime() - art.DAY_MS);
    return { key: `${art.parts(at).day}T${String(hour).padStart(2, '0')}`, at };
  };
}

/** Ventana cada N horas desde las 00:00 ART. */
function everyHours(n) {
  return (now) => {
    const midnight = art.startOfArtDay(now).getTime();
    const slot = Math.floor((now.getTime() - midnight) / (n * art.HOUR_MS));
    const at = new Date(midnight + slot * n * art.HOUR_MS);
    const p = art.parts(at);
    return { key: `${p.day}T${String(p.h).padStart(2, '0')}`, at };
  };
}

/**
 * Corre la ventana vigente de un job si no se corrió y sigue dentro del margen.
 * El mismo código hace la corrida normal y la de recuperación al arrancar.
 * Devuelve 'ran' | 'done' | 'late' | 'locked' | 'error'.
 */
async function runDue(job, now = clock.now()) {
  const { key, at } = job.window(now);
  if (now.getTime() - at.getTime() > job.graceMs) return 'late';
  const before = await jobLock.state(job.name);
  if (before && before.lastWindow === key) return 'done';
  if (!(await jobLock.acquire(job.name, job.leaseMs))) return 'locked';
  try {
    const fresh = await jobLock.state(job.name);
    if (fresh && fresh.lastWindow === key) return 'done';
    await job.run({ key, at, now });
    await jobLock.markDone(job.name, key);
    logger.info('job hecho', { job: job.name, window: key });
    return 'ran';
  } catch (err) {
    logger.error(`job ${job.name}`, err);
    return 'error';
  } finally {
    await jobLock.release(job.name);
  }
}

function buildJobs(deps) {
  const instantEvery = num('INSTANT_ALERTS_EVERY_HOURS', 3);
  return [
    { name: 'digest', window: dailyAt(21), graceMs: num('DIGEST_GRACE_HOURS', 3) * art.HOUR_MS, leaseMs: 30 * MIN_MS, run: deps.digest },
    { name: 'expire', window: everyHours(1), graceMs: art.HOUR_MS, leaseMs: 15 * MIN_MS, run: deps.expire },
    { name: 'fx', window: dailyAt(10), graceMs: 12 * art.HOUR_MS, leaseMs: 15 * MIN_MS, run: deps.fx },
    { name: 'instant', window: everyHours(instantEvery), graceMs: instantEvery * art.HOUR_MS, leaseMs: 30 * MIN_MS, run: deps.instant },
    // Lo que se guardó por horario de silencio sale a las 08:00.
    { name: 'instant-morning', window: dailyAt(8), graceMs: 4 * art.HOUR_MS, leaseMs: 30 * MIN_MS, run: deps.instant },
  ].filter((job) => typeof job.run === 'function');
}

async function tick(jobs, now = clock.now()) {
  const out = {};
  for (const job of jobs) out[job.name] = await runDue(job, now);
  return out;
}

let timer = null;

/** Arranca con el proceso: un tick inmediato (recuperación) y después cada minuto. */
function start(deps, opts = {}) {
  if (timer) return timer;
  const jobs = buildJobs(deps);
  const loop = () => tick(jobs).catch((err) => logger.error('tick', err));
  const first = setTimeout(loop, opts.firstDelayMs ?? 5000);
  if (first.unref) first.unref();
  timer = setInterval(loop, opts.everyMs || MIN_MS);
  if (timer.unref) timer.unref();
  return timer;
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick, runDue, buildJobs, dailyAt, everyHours };
