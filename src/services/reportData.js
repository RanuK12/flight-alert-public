'use strict';

/**
 * Datos del informe diario (DTO plano, sin I/O de render).
 * Estados por ruta: 'deal' (precio fresco ≤ tope), 'above' (precio fresco > tope o sin tope), 'empty' (sin precio fresco).
 * Nunca inventa datos: sin historial no hay delta ni sparkline.
 */

const I18N = require('./report.i18n.json');
const { col } = require('../database');
const art = require('../utils/art');
const logger = require('../utils/logger').child('report');
const priceHistory = require('./priceHistory');
const travelpayouts = require('../providers/travelpayouts');
const { sortFlights, isFresh } = require('./sortFlights');
const { bookingUrl } = require('../bot/deepLinks');

const TZ = 'America/Argentina/Cordoba';
const HOUR = 60 * 60 * 1000;

function langFor(lang) {
  return I18N[lang] ? lang : 'es';
}

function tr(lang, key, vars = {}) {
  const s = (I18N[langFor(lang)][key] ?? I18N.es[key] ?? key);
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
}

/** Espacios finos de Intl → NBSP (la fuente embebida no trae U+202F). */
function clean(s) {
  return String(s).replace(/[\u202F\u2009]/g, '\u00A0');
}

function money(value, currency, lang) {
  return clean(new Intl.NumberFormat(tr(lang, 'locale'), { style: 'currency', currency: currency || 'EUR', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(Math.round(value)));
}

/** Porcentaje con signo explícito y menos tipográfico, ej. "−12 %" / "+4 %". */
function signedPct(pct) {
  const n = Math.round(pct);
  const sign = n < 0 ? '\u2212' : '+';
  return `${sign}${Math.abs(n)}\u00A0%`;
}

function longDate(now, lang) {
  return clean(new Intl.DateTimeFormat(tr(lang, 'locale'), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now));
}

function shortDate(iso, lang) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return clean(new Intl.DateTimeFormat(tr(lang, 'locale'), { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(d));
}

function hhmm(now) {
  const p = art.parts(now);
  return `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
}

function hoursAgo(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / HOUR));
}

/** "hace minutos" si pasó menos de 1 h; si no, "hace N h" (nunca "hace 0 h"). */
function agoLabel(lang, iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now.getTime() - t);
  if (ms < HOUR) return tr(lang, 'minutesAgo');
  return tr(lang, 'hoursAgo', { h: Math.max(1, Math.round(ms / HOUR)) });
}

function isRoundtrip(r) {
  return r.tripType === 'roundtrip' || Boolean(r.returnDate) || Boolean(r.stayDays);
}

function nightsOf(r) {
  if (r.stayDays) return Number(r.stayDays);
  if (r.returnDate && r.outboundDate) {
    return Math.round((Date.parse(`${r.returnDate}T00:00:00Z`) - Date.parse(`${r.outboundDate}T00:00:00Z`)) / 86400000);
  }
  return null;
}

function tripLabel(r, lang) {
  if (!isRoundtrip(r)) return tr(lang, 'oneway');
  const n = nightsOf(r);
  return n && n > 0 ? tr(lang, 'roundtrip', { n }) : tr(lang, 'roundtripFlex');
}

function stopsLabel(stops, lang) {
  if (stops === null || stops === undefined) return '';
  if (Number(stops) === 0) return tr(lang, 'direct');
  if (Number(stops) === 1) return tr(lang, 'stops1');
  return tr(lang, 'stopsN', { n: stops });
}

function sourceName(source) {
  return source === 'duffel' ? 'Duffel' : 'Travelpayouts';
}

/** Delta vs el mínimo de un día dado del historial (null si no hay dato: nunca "0 %"). */
function deltaVs(hist, now, daysBack, price) {
  const day = priceHistory.dayOf(new Date(now.getTime() - daysBack * art.DAY_MS));
  const row = hist.find((h) => h.date === day);
  if (!row || !(row.price > 0)) return null;
  const pct = Math.round(((price - row.price) / row.price) * 1000) / 10;
  return { pct, label: signedPct(pct), dir: pct < -0.5 ? 'down' : (pct > 0.5 ? 'up' : 'flat') };
}

function trendOf(hist) {
  if (hist.length < 2) return null;
  const first = hist[0].price;
  const last = hist[hist.length - 1].price;
  if (last < first * 0.98) return 'down';
  if (last > first * 1.02) return 'up';
  return 'flat';
}

/** Tarjeta de una ruta. `route` ya trae el mejor precio (persistido o de la búsqueda en vivo). */
function cardFor(route, hist, now, lang, links) {
  const ceiling = Number(route.priceThreshold) > 0 ? Number(route.priceThreshold) : null;
  const currency = route.currency || 'EUR';
  const fresh = Number(route.lastPriceEur) > 0 && route.foundAt && isFresh({ foundAt: route.foundAt }, now);
  const base = {
    title: `${route.origin} \u2192 ${route.destination}`,
    trip: tripLabel(route, lang),
    ceiling,
    ceilingLabel: ceiling ? tr(lang, 'ceiling', { price: money(ceiling, currency, lang) }) : tr(lang, 'noCeiling'),
  };
  const histPoints = hist.length >= 2 ? hist.map((h) => h.price) : null;
  if (!fresh) {
    const lastHist = hist.length ? hist[hist.length - 1] : null;
    const lastPrice = Number(route.lastPriceEur) > 0 ? Number(route.lastPriceEur) : (lastHist ? lastHist.price : null);
    const lastAt = route.foundAt || (lastHist ? `${lastHist.date}T12:00:00-03:00` : null);
    let lastSeen = tr(lang, 'neverSeen');
    if (lastPrice && lastAt) {
      const h = hoursAgo(lastAt, now);
      lastSeen = h < 48
        ? tr(lang, 'lastSeenToday', { price: money(lastPrice, currency, lang), ago: agoLabel(lang, lastAt, now) })
        : tr(lang, 'lastSeen', { price: money(lastPrice, currency, lang), d: Math.round(h / 24) });
    }
    const trend = trendOf(hist);
    return {
      ...base,
      state: 'empty',
      emptyTitle: tr(lang, 'emptyTitle'),
      lastSeen,
      trend: trend ? tr(lang, trend === 'down' ? 'trendDown' : trend === 'up' ? 'trendUp' : 'trendFlat') : null,
      tip: tr(lang, 'tip'),
      cta: tr(lang, 'editAlert'),
      ctaUrl: links.edit,
      sort: 3,
    };
  }
  const price = Number(route.lastPriceEur);
  const pct = ceiling ? Math.round(((price - ceiling) / ceiling) * 1000) / 10 : null;
  const state = ceiling && price <= ceiling ? 'deal' : 'above';
  let vsCeiling = '';
  if (ceiling) {
    if (Math.round(pct) === 0) vsCeiling = tr(lang, 'atCeiling');
    else vsCeiling = tr(lang, pct < 0 ? 'below' : 'above', { pct: signedPct(pct) });
  }
  const seenAgo = agoLabel(lang, route.foundAt, now);
  const confirmedAgo = route.source === 'duffel' ? agoLabel(lang, route.confirmedAt || route.foundAt, now) : null;
  const dep = route.bestDepartureDate || route.outboundDate;
  const ret = route.bestReturnDate || (route.stayDays ? null : route.returnDate);
  const url = bookingUrl({ origin: route.origin, destination: route.destination, departureDate: dep, returnDate: ret || null });
  const todayPoint = hist.length && hist[hist.length - 1].date === priceHistory.dayOf(now);
  return {
    ...base,
    state,
    stateLabel: tr(lang, state === 'deal' ? 'stateDeal' : 'stateAbove'),
    price,
    priceLabel: money(price, currency, lang),
    pct,
    vsCeiling,
    ratio: ceiling ? Math.round((price / ceiling) * 1000) / 1000 : null,
    deltaDay: deltaVs(hist, now, 1, price),
    delta7: deltaVs(hist, now, 7, price),
    deltaDayLabel: tr(lang, 'vsYesterday'),
    delta7Label: tr(lang, 'vs7'),
    spark: histPoints,
    sparkToday: Boolean(todayPoint),
    dates: [shortDate(dep, lang), ret ? shortDate(ret, lang) : null].filter(Boolean).join(' \u2192 '),
    airline: route.gate || null,
    stops: stopsLabel(route.stops, lang),
    sourceLine: tr(lang, 'source', { source: sourceName(route.source), ago: seenAgo || '' }),
    confirmed: confirmedAgo ? tr(lang, 'confirmed', { ago: confirmedAgo }) : null,
    disclaimer: tr(lang, 'disclaimer'),
    cta: tr(lang, 'seeDeal'),
    url,
    sort: state === 'deal' ? 1 : 2,
  };
}

function orderCards(cards) {
  return cards.slice().sort((a, b) => {
    if (a.sort !== b.sort) return a.sort - b.sort;
    const pa = a.pct ?? Infinity;
    const pb = b.pct ?? Infinity;
    if (pa !== pb) return pa - pb;
    return (a.price ?? Infinity) - (b.price ?? Infinity);
  });
}

/**
 * Arma el DTO del informe. `routes` deben venir ya con el mejor precio (ver liveFill).
 * `histByKey` es un Map routeKey → historial (compartido entre usuarios).
 */
/** Cuántas tarjetas completas y cuántas filas compactas como máximo (acota páginas y memoria). */
function layoutLimits() {
  return { full: Math.max(1, num('REPORT_FULL_CARDS', 5)), rows: Math.max(0, num('REPORT_MAX_ROWS', 40)) };
}

function compactRow(c, lang) {
  let status;
  if (c.state === 'deal') status = tr(lang, 'statusDeal');
  else if (c.state === 'above') status = c.pct !== null ? tr(lang, 'statusAboveShort', { pct: signedPct(c.pct) }) : tr(lang, 'stateAbove');
  else status = tr(lang, 'statusEmpty');
  return { title: c.title, price: c.priceLabel || '\u2014', status, state: c.state, url: c.url || null };
}

function buildReport({ routes, user = {}, now, lang, histByKey = new Map(), links = {}, maxAlerts = null, note = null }) {
  const L = langFor(lang);
  const cards = orderCards(routes.map((r) => cardFor(r, histByKey.get(priceHistory.routeKey(r)) || [], now, L, links)));
  const priced = cards.filter((c) => c.state !== 'empty');
  const deals = cards.filter((c) => c.state === 'deal');
  const best = deals[0] || priced.slice().sort((a, b) => a.price - b.price)[0] || null;
  const hasHistory = routes.some((r) => (histByKey.get(priceHistory.routeKey(r)) || []).length >= 2);
  const dropped = hasHistory ? priced.filter((c) => c.deltaDay && c.deltaDay.dir === 'down').length : null;
  const n = cards.length;
  const lim = layoutLimits();
  const full = cards.slice(0, lim.full);
  const restAll = cards.slice(lim.full);
  const compact = restAll.slice(0, lim.rows).map((c) => compactRow(c, L));
  const hidden = restAll.length - compact.length;
  return {
    lang: L,
    brand: tr(L, 'brand'),
    hello: user.firstName ? tr(L, 'hello', { name: user.firstName }) : tr(L, 'helloAnon'),
    date: longDate(now, L),
    dayIso: priceHistory.dayOf(now),
    generated: tr(L, 'generated', { time: hhmm(now) }),
    allEmpty: n > 0 && priced.length === 0,
    allEmptyText: tr(L, 'allEmpty', { n }),
    kpis: {
      active: { label: tr(L, 'kpiActive'), value: String(n) },
      under: { label: tr(L, 'kpiUnder'), value: `${deals.length}/${n}` },
      best: best ? { label: tr(L, 'kpiBest'), value: best.priceLabel, sub: best.title } : null,
      dropped: dropped !== null ? { label: tr(L, 'kpiDropped'), value: String(dropped) } : null,
    },
    counts: { n, deals: deals.length, priced: priced.length },
    best,
    cards,
    full,
    compact,
    compactTitle: tr(L, 'compactTitle'),
    more: restAll.length,
    moreText: hidden > 0 ? tr(L, 'moreRoutes', { m: hidden }) : null,
    note,
    footer: {
      watch: tr(L, 'footerWatch'),
      manage: tr(L, 'footerManage'),
      manageUrl: links.manage || null,
      affiliate: tr(L, 'footerAffiliate'),
      unsub: tr(L, 'footerUnsub'),
      upsell: (n === 1 || (maxAlerts && n >= maxAlerts - 1)) ? tr(L, 'upsell') : null,
    },
    pageLabel: (p, total) => tr(L, 'page', { p, n: total }),
  };
}

/** Caption ≤1024 caracteres (3 líneas) y teclado con 2 botones. */
function captionFor(report) {
  const L = report.lang;
  const lines = [tr(L, 'captionTitle', { date: report.date })];
  const { n, deals, priced } = report.counts;
  if (!priced) {
    lines.push(tr(L, 'captionEmpty', { n }));
  } else if (deals && report.best) {
    lines.push(tr(L, 'captionDeals', { k: deals, n, route: report.best.title, price: report.best.priceLabel, pct: signedPct(report.best.pct) }));
    lines.push(tr(L, 'captionRef'));
  } else {
    lines.push(tr(L, 'captionNoDeal', { n: priced, route: report.best.title, price: report.best.priceLabel }));
    lines.push(tr(L, 'captionRef'));
  }
  if (report.more > 0) lines[1] = lines[1].replace(/\.?$/, `${tr(L, 'captionMore', { m: report.more })}.`);
  return lines.join('\n').slice(0, 1024);
}

function keyboardFor(report, links = {}) {
  const row = [];
  if (report.best && report.best.url) row.push({ text: tr(report.lang, 'btnBest'), url: report.best.url });
  if (links.webApp) row.push({ text: tr(report.lang, 'btnAlerts'), web_app: { url: links.webApp } });
  return row.length ? { inline_keyboard: [row] } : undefined;
}

function fileName(report) {
  return `FlightAlert_${report.dayIso}.pdf`;
}

/** Texto de respaldo (si el PDF falla). Distingue "sin precio" de "arriba de tu tope". */
function textFor(report) {
  const L = report.lang;
  const { n, deals, priced } = report.counts;
  const head = [tr(L, 'textTitle', { date: report.date }), tr(L, 'textActive', { n })];
  if (!priced) head.push(tr(L, 'textEmpty'));
  else if (!deals) head.push(tr(L, 'textAboveOnly', { m: priced }));
  else head.push(tr(L, 'textSummary', { k: deals, n }));
  head.push(tr(L, 'captionRef'));
  const items = report.cards.filter((c) => c.state !== 'empty').slice(0, 8).map((c) => ({
    text: [
      `${c.title} · ${c.trip}`,
      [c.priceLabel, c.vsCeiling, c.stops, c.dates].filter(Boolean).join(' · '),
      c.sourceLine,
      c.disclaimer,
    ].join('\n'),
    extra: { reply_markup: { inline_keyboard: [[{ text: tr(L, 'textBtn'), url: c.url }]] } },
  }));
  return { header: head.join('\n'), items };
}

function num(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
}

/**
 * Presupuesto global de una corrida del informe: concurrencia, tope total de Duffel,
 * tope de búsquedas en vivo y deadline. Se comparte entre todos los usuarios.
 */
function createBudget(now = new Date()) {
  return {
    duffelLeft: num('DIGEST_DUFFEL_MAX', 8),
    liveLeft: num('DIGEST_LIVE_MAX', 30),
    concurrency: Math.max(1, num('DIGEST_CONCURRENCY', 2)),
    routeTimeoutMs: num('DIGEST_ROUTE_TIMEOUT_MS', 20000),
    deadline: Date.now() + num('DIGEST_DEADLINE_MS', 240000),
    perRouteDuffel: Math.min(3, num('DIGEST_DUFFEL_PER_ROUTE', 3)),
    active: 0,
    waiters: [],
    cache: new Map(),
    hist: new Map(),
    stats: { live: 0, duffelReserved: 0, timeouts: 0, skipped: 0 },
    startedAt: now,
  };
}

async function acquire(b) {
  if (b.active < b.concurrency) { b.active += 1; return; }
  await new Promise((resolve) => b.waiters.push(resolve));
  b.active += 1;
}

function release(b) {
  b.active -= 1;
  const next = b.waiters.shift();
  if (next) next();
}

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const t = new Promise((resolve) => { timer = setTimeout(() => { onTimeout(); resolve(null); }, ms); });
  return Promise.race([promise, t]).finally(() => clearTimeout(timer));
}

/** Búsqueda en vivo de una ruta sin precio fresco. Compartida por routeKey dentro de la corrida. */
function liveLookup(route, now, budget, queryFor, matchesRoute) {
  const key = priceHistory.routeKey(route);
  if (budget.cache.has(key)) return budget.cache.get(key);
  const p = (async () => {
    if (budget.liveLeft <= 0 || Date.now() >= budget.deadline) { budget.stats.skipped += 1; return null; }
    budget.liveLeft -= 1;
    await acquire(budget);
    try {
      if (Date.now() >= budget.deadline) { budget.stats.skipped += 1; return null; }
      const { kind, q } = queryFor(route, now);
      const reserve = Math.min(kind === 'range' ? budget.perRouteDuffel : 1, budget.duffelLeft);
      budget.duffelLeft -= reserve;
      budget.stats.duffelReserved += reserve;
      budget.stats.live += 1;
      let search;
      if (kind === 'range') search = travelpayouts.searchRange({ ...q, duffelMax: reserve });
      else if (reserve >= 1 || travelpayouts.enabled()) search = travelpayouts.search(q);
      else return null;
      const ms = Math.min(budget.routeTimeoutMs, Math.max(0, budget.deadline - Date.now()));
      const rows = await withTimeout(Promise.resolve(search).catch(() => []), ms, () => { budget.stats.timeouts += 1; });
      return sortFlights((rows || []).filter((f) => matchesRoute(route, f)))[0] || null;
    } catch (err) {
      logger.warn('live', { error: err.message });
      return null;
    } finally {
      release(budget);
    }
  })();
  budget.cache.set(key, p);
  return p;
}

/**
 * Completa precios: usa lo persistido si es fresco; si no, busca en vivo (con presupuesto)
 * y guarda el resultado en la ruta + PriceHistory.
 */
async function liveFill(routes, now, budget, deps) {
  const { queryFor, matchesRoute } = deps;
  // Tope por usuario: con muchas alertas no se gasta todo el presupuesto global en una sola persona.
  let userLive = deps.maxLive ?? num('DIGEST_LIVE_PER_USER', 6);
  const out = await Promise.all(routes.map(async (r) => {
    const fresh = Number(r.lastPriceEur) > 0 && r.foundAt && isFresh({ foundAt: r.foundAt }, now);
    if (fresh) return r;
    if (userLive <= 0) { budget.stats.skipped += 1; return r; }
    userLive -= 1;
    const best = await liveLookup(r, now, budget, queryFor, matchesRoute);
    if (!best) return r;
    const set = {
      lastPriceEur: best.price,
      foundAt: best.foundAt || now.toISOString(),
      stops: best.stops ?? null,
      durationMin: best.durationMin ?? null,
      bestDepartureDate: best.departureDate || null,
      bestReturnDate: best.returnDate || null,
      gate: best.gate || null,
      source: best.source || 'travelpayouts',
      checkedAt: now.toISOString(),
      ...(best.source === 'duffel' ? { confirmedAt: best.foundAt || now.toISOString() } : {}),
    };
    try {
      if (r._id) await col('Route').updateOne({ _id: r._id }, { $set: set });
      await priceHistory.record(r, best, now);
    } catch (err) {
      logger.warn('store', { error: err.message });
    }
    return { ...r, ...set };
  }));
  return out;
}

async function historyFor(routes, now, budget) {
  const map = budget ? budget.hist : new Map();
  for (const r of routes) {
    const k = priceHistory.routeKey(r);
    if (!map.has(k)) map.set(k, await priceHistory.history(r, now, 30));
  }
  return map;
}

module.exports = {
  I18N, tr, money, signedPct, longDate, shortDate, buildReport, captionFor, keyboardFor, fileName, textFor,
  createBudget, liveFill, layoutLimits, agoLabel, liveLookup, historyFor, cardFor, orderCards,
};
