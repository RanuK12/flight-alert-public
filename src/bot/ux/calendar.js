'use strict';

const clock = require('../../utils/clock');
const { t } = require('./i18n');
const cb = require('./cb');

const TZ = 'America/Argentina/Buenos_Aires';

/** Hoy en Argentina como { y, m (1-12), d }. */
function today(now = clock.now()) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type) => Number(p.find((x) => x.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function daysIn(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** YYMM <-> { y, m } */
function ym(code) {
  const s = String(code || '');
  if (!/^\d{4}$/.test(s)) return null;
  const m = Number(s.slice(2));
  if (m < 1 || m > 12) return null;
  return { y: 2000 + Number(s.slice(0, 2)), m };
}
function ymCode(y, m) {
  return `${String(y % 100).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}
function addMonths(y, m, n) {
  const idx = y * 12 + (m - 1) + n;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}
/** YYMMDD <-> ISO */
function ymdToIso(code) {
  const s = String(code || '');
  if (!/^\d{6}$/.test(s)) return null;
  return `20${s.slice(0, 2)}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
}
function isoToYmd(iso) {
  return String(iso).slice(2, 10).replace(/-/g, '');
}
function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function addDays(isoDate, n) {
  const dt = new Date(`${isoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function diffDays(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}
function todayIso(now) {
  const x = today(now);
  return iso(x.y, x.m, x.d);
}

function monthName(lang, y, m) {
  return `${t(lang, 'months')[m - 1]} ${y}`;
}
function shortDate(lang, isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return lang === 'es' ? `${d} ${t(lang, 'monthsShort')[m - 1].toLowerCase()} ${y}` : `${t(lang, 'monthsShort')[m - 1]} ${d}, ${y}`;
}

/** Próximos 12 meses; el actual solo si quedan ≥3 días (contando hoy). */
function months(now = clock.now()) {
  const x = today(now);
  const out = [];
  const start = daysIn(x.y, x.m) - x.d + 1 >= 3 ? 0 : 1;
  for (let i = start; out.length < 12; i += 1) out.push(addMonths(x.y, x.m, i));
  return out;
}

function monthKeyboard(lang, flow, fields, now) {
  const rows = [];
  const list = months(now);
  for (let i = 0; i < list.length; i += 3) {
    rows.push(list.slice(i, i + 3).map(({ y, m }) => ({
      text: `${t(lang, 'monthsShort')[m - 1]} ${String(y % 100).padStart(2, '0')}`,
      callback_data: cb.encode(flow, 'day', { ...fields, m: ymCode(y, m) }),
    })));
  }
  rows.push([{ text: t(lang, 'anyDate'), callback_data: cb.encode(flow, 'after', { ...fields, m: 'x', f: 'x' }) }]);
  return rows;
}

/**
 * Grilla Lu..Do. Días < min (ISO) van como "·" con noop. Hoy marcado con •.
 * pick(dayIso) devuelve el callback_data del día; nav(ymcode) el de cambiar de mes.
 */
function dayGrid(lang, y, m, { min, pick, nav, anyDay, now }) {
  const rows = [];
  const first = months(now)[0];
  const last = months(now)[11];
  const prev = addMonths(y, m, -1);
  const next = addMonths(y, m, 1);
  const canPrev = prev.y * 12 + prev.m >= first.y * 12 + first.m;
  const canNext = next.y * 12 + next.m <= last.y * 12 + last.m;
  rows.push([
    { text: canPrev ? '◀' : ' ', callback_data: canPrev ? nav(ymCode(prev.y, prev.m)) : 'noop' },
    { text: monthName(lang, y, m).replace(/^./, (c) => c.toUpperCase()), callback_data: 'noop' },
    { text: canNext ? '▶' : ' ', callback_data: canNext ? nav(ymCode(next.y, next.m)) : 'noop' },
  ]);
  rows.push(t(lang, 'days').map((d) => ({ text: d, callback_data: 'noop' })));
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const total = daysIn(y, m);
  const tIso = todayIso(now);
  let row = Array.from({ length: offset }, () => ({ text: ' ', callback_data: 'noop' }));
  for (let d = 1; d <= total; d += 1) {
    const dayIso = iso(y, m, d);
    if (dayIso < min) row.push({ text: '·', callback_data: 'noop' });
    else row.push({ text: dayIso === tIso ? `•${d}` : String(d), callback_data: pick(dayIso) });
    if (row.length === 7) { rows.push(row); row = []; }
  }
  if (row.length) {
    while (row.length < 7) row.push({ text: ' ', callback_data: 'noop' });
    rows.push(row);
  }
  if (anyDay) rows.push([{ text: t(lang, 'anyDay', { month: t(lang, 'months')[m - 1] }), callback_data: anyDay }]);
  return rows;
}

module.exports = {
  TZ, today, todayIso, daysIn, ym, ymCode, addMonths, ymdToIso, isoToYmd, iso, addDays, diffDays,
  months, monthKeyboard, dayGrid, monthName, shortDate,
};
