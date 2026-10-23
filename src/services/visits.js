'use strict';

/**
 * Contador de visitas propio: server-side, sin cookies ni terceros.
 * Agregado por día (ART): pageviews, únicos, top páginas, dominio referrer y utm_source.
 * Únicos = sha256(IP + UA + sal diaria). La IP nunca se guarda. TTL 90 días.
 * Nunca rompe ni demora un request: fire-and-forget con catch.
 */

const crypto = require('crypto');
const { col } = require('../database');
const clock = require('../utils/clock');
const art = require('../utils/art');
const logger = require('../utils/logger').child('visits');

const RETENTION_DAYS = 90;
const SEEN_HOURS = 48;
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|go-http|java\/|httpclient|scrapy|ahrefs|semrush|mj12|bingpreview|whatsapp|telegram|discord|skype|vkshare|bytespider|gptbot|claude|perplexity/i;
const STATIC = /\.(css|js|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|txt|xml|json|map)$/i;
const MAX_KEYS = 200;
const processSecret = crypto.randomBytes(32).toString('hex');

function secret() {
  return process.env.VISITS_SALT_SECRET || process.env.DEVICE_COOKIE_SECRET || processSecret;
}

function dayKey(date) {
  return art.parts(date).day;
}

function dailySalt(day) {
  return crypto.createHmac('sha256', secret()).update(`visits:${day}`).digest('hex');
}

function visitorHash(ip, ua, day) {
  return crypto.createHash('sha256').update(`${ip}|${ua}|${dailySalt(day)}`).digest('hex');
}

/** Clave segura para Mongo (sin '.' ni '$'), corta. */
function safeKey(value, max = 80) {
  return String(value || '').replace(/[.$]/g, '_').replace(/[^\w\-/_:]/g, '').slice(0, max) || '-';
}

function isBot(ua) {
  return !ua || BOT_UA.test(ua);
}

function refDomain(referer, ownHost) {
  if (!referer) return 'direct';
  try {
    const host = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return 'direct';
    if (ownHost && host === String(ownHost).toLowerCase().replace(/^www\./, '')) return null;
    return host;
  } catch (_err) { return 'direct'; }
}

/** ¿Este request cuenta como visita? */
function shouldCount(req, isPage) {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  if (p === '/health' || p.startsWith('/webhooks') || p.startsWith('/admin') || p.startsWith('/api') || p.startsWith('/public') || p.startsWith('/assets')) return false;
  if (STATIC.test(p)) return false;
  if (p.startsWith('/app/') && p !== '/app/') return false; // llamadas internas de la Mini App
  if (!isPage(p)) return false;
  const accept = String(req.headers.accept || '');
  if (accept && !/text\/html|\*\/\*/.test(accept)) return false;
  if (isBot(String(req.headers['user-agent'] || ''))) return false;
  if (String(req.headers.purpose || req.headers['sec-purpose'] || '').includes('prefetch')) return false;
  return true;
}

async function record({ ip, ua, path, referer, host, utm, now = clock.now() }) {
  const day = dayKey(now);
  const expireAt = new Date(now.getTime() + RETENTION_DAYS * art.DAY_MS);
  const inc = { pageviews: 1 };
  const page = safeKey(path === '/app/' ? '/app' : path);
  inc[`pages.${page}`] = 1;
  const ref = refDomain(referer, host);
  if (ref) inc[`refs.${safeKey(ref, 60)}`] = 1;
  if (utm) inc[`utm.${safeKey(String(utm).toLowerCase(), 40)}`] = 1;
  const key = `${day}:${visitorHash(ip, ua, day)}`;
  const Seen = col('VisitSeen');
  const seen = await Seen.findOne({ key });
  if (!seen) {
    await Seen.create({ key, expireAt: new Date(now.getTime() + SEEN_HOURS * art.HOUR_MS) });
    inc.uniques = 1;
  }
  const doc = await col('VisitDay').findOne({ day });
  if (doc && Object.keys(doc.pages || {}).length > MAX_KEYS) {
    for (const k of Object.keys(inc)) if (k.startsWith('pages.') && !(k.slice(6) in (doc.pages || {}))) { delete inc[k]; inc['pages._otras'] = 1; }
  }
  await col('VisitDay').updateOne({ day }, { $inc: inc, $setOnInsert: { day, expireAt } }, { upsert: true });
}

function middleware(isPage) {
  return (req, res, next) => {
    try {
      if (shouldCount(req, isPage)) {
        const data = {
          ip: req.ip || (req.socket && req.socket.remoteAddress) || 'local',
          ua: String(req.headers['user-agent'] || '').slice(0, 300),
          path: req.path,
          referer: req.headers.referer || req.headers.referrer || '',
          host: req.hostname,
          utm: req.query && typeof req.query.utm_source === 'string' ? req.query.utm_source : '',
        };
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          setImmediate(() => { record(data).catch((err) => logger.warn('visits record', { error: err.message })); });
        });
      }
    } catch (err) { logger.warn('visits mw', { error: err.message }); }
    next();
  };
}

/** Lee un bucket tanto anidado (Mongo) como con claves "a.b" (memoria). */
function bucket(doc, name) {
  const out = {};
  const nested = doc && doc[name] && typeof doc[name] === 'object' ? doc[name] : {};
  for (const [k, v] of Object.entries(nested)) out[k] = (out[k] || 0) + (Number(v) || 0);
  for (const [k, v] of Object.entries(doc || {})) if (k.startsWith(`${name}.`)) out[k.slice(name.length + 1)] = (out[k.slice(name.length + 1)] || 0) + (Number(v) || 0);
  return out;
}

function top(map, n = 5) {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
}

async function range(days, now = clock.now(), offset = 0) {
  const keys = [];
  for (let i = offset; i < offset + days; i += 1) keys.push(dayKey(new Date(now.getTime() - i * art.DAY_MS)));
  const list = await col('VisitDay').find({ day: { $in: keys } }).lean();
  const agg = { pageviews: 0, uniques: 0, pages: {}, sources: {} };
  for (const d of list || []) {
    agg.pageviews += Number(d.pageviews) || 0;
    agg.uniques += Number(d.uniques) || 0;
    for (const [k, v] of Object.entries(bucket(d, 'pages'))) agg.pages[k] = (agg.pages[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket(d, 'refs'))) agg.sources[k] = (agg.sources[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket(d, 'utm'))) agg.sources[`utm:${k}`] = (agg.sources[`utm:${k}`] || 0) + v;
  }
  return agg;
}

async function conversion(days, now = clock.now()) {
  try {
    const since = new Date(now.getTime() - days * art.DAY_MS);
    const list = (await col('StartEvent').find({ at: { $gte: since } }).lean()) || [];
    const ids = [...new Set(list.map((e) => String(e.telegramUserId)))];
    if (!ids.length) return null;
    const nowIso = now.toISOString();
    let pro = 0;
    for (const id of ids) {
      const e = await col('Entitlement').findOne({ telegramUserId: id });
      if (e && e.plan === 'pro' && (!e.proUntil || e.proUntil > nowIso)) pro += 1;
    }
    return { starts: ids.length, pro };
  } catch (_err) { return null; }
}

async function statsText(now = clock.now()) {
  const [t, y, w, m] = await Promise.all([range(1, now), range(1, now, 1), range(7, now), range(30, now)]);
  const line = (label, a) => `${label}: ${a.pageviews} vistas · ${a.uniques} únicos`;
  const fmt = (pairs) => (pairs.length ? pairs.map(([k, v]) => `  ${k} — ${v}`).join('\n') : '  (sin datos)');
  const conv = await conversion(30, now);
  return [
    '📊 Visitas (sin bots ni admin)',
    line('Hoy', t), line('Ayer', y), line('7 días', w), line('30 días', m),
    '(únicos sumados por día)',
    'Top páginas (30d):', fmt(top(m.pages)),
    'Top fuentes (30d):', fmt(top(m.sources)),
    conv ? `/start→Pro (30d): ${conv.pro}/${conv.starts} (${Math.round((conv.pro / conv.starts) * 100)}%)` : '/start→Pro: sin datos',
  ].join('\n');
}

async function todayLine(now = clock.now()) {
  try {
    const t = await range(1, now);
    return `Visitas hoy: ${t.pageviews} vistas · ${t.uniques} únicos`;
  } catch (_err) { return 'Visitas hoy: s/d'; }
}

module.exports = { middleware, record, shouldCount, isBot, refDomain, visitorHash, dayKey, range, statsText, todayLine, bucket, RETENTION_DAYS };
