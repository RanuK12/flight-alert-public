'use strict';

/**
 * Asistente de /buscar (flujo "b") y /nueva_alerta (flujo "a") con un solo panel que se edita.
 * El estado viaja en el callback_data; next() calcula el primer paso que falta, así
 * "Atrás" = sacar el campo del paso anterior y "Editar" = sacar ese campo y volver solo al resumen.
 */
const { ORIGINS, DESTINATIONS } = require('../../config/airports');
const places = require('./places');
const cal = require('./calendar');
const cb = require('./cb');
const { t } = require('./i18n');

const STAYS = ['7', '14', '21'];

/** Orden de pasos y el campo que fija cada uno. */
function order(flow, f) {
  const steps = [['org', ['o']], ['dst', ['d', 'p']], ['typ', ['t']], ['mon', ['m', 'f']], ['day', ['f']]];
  if (f.t === '2') steps.push(['ret', ['r', 'n', 'q']]);
  if (flow === 'a') steps.push(['when', ['w', 'c']]);
  return steps;
}

function clean(f) {
  const out = {};
  for (const k of ['o', 'd', 't', 'm', 'f', 'r', 'n', 'q', 'w', 'c', 'p']) if (f[k] !== undefined && f[k] !== '') out[k] = f[k];
  return out;
}

function next(flow, f) {
  if (!f.o) return 'org';
  if (!f.d) return 'dst';
  if (!f.t) return 'typ';
  if (!f.m) return 'mon';
  if (!f.f) return 'day';
  if (f.t === '2' && !f.r && !f.n) return f.q ? 'rday' : 'ret';
  if (flow === 'a' && !f.w) return 'when';
  if (flow === 'a' && f.w === 'p' && !f.c) return 'ceil';
  return 'sum';
}

/** Campos sin lo que fijó el paso anterior al actual. */
function backFields(flow, f) {
  const cur = next(flow, f);
  const g = { ...f };
  if (cur === 'rday') { delete g.q; return g; }
  if (cur === 'ceil') { delete g.w; return g; }
  if (cur === 'dst' && g.p) { delete g.p; return g; }
  const steps = order(flow, f).map((s) => s[0]);
  const idx = cur === 'sum' ? steps.length : steps.indexOf(cur);
  for (let i = idx - 1; i >= 0; i -= 1) {
    const [name, keys] = order(flow, f)[i];
    if (name === 'day' && f.m === 'x') continue; // "cualquier fecha" fijó m y f juntos
    if (keys.some((k) => g[k] !== undefined)) {
      keys.forEach((k) => delete g[k]);
      if (name === 'day' && f.m === 'x') delete g.m;
      if (name === 'mon') delete g.f;
      return g;
    }
  }
  return g;
}

const nx = (flow, f) => cb.encode(flow, 'nx', clean(f));

function navRow(lang, flow, f, withBack = true) {
  const row = [];
  if (withBack) row.push({ text: t(lang, 'back'), callback_data: nx(flow, backFields(flow, f)) });
  row.push({ text: t(lang, 'cancel'), callback_data: cb.encode(flow, 'x') });
  return row;
}

function departIso(f) {
  const m = cal.ym(f.m);
  if (!m || f.f === 'x' || !f.f) return null;
  return cal.iso(m.y, m.m, Number(f.f));
}

function whenText(lang, f) {
  if (f.m === 'x') return t(lang, 'nextMonths');
  const m = cal.ym(f.m);
  if (!m) return '';
  if (f.f === 'x') return t(lang, 'anyDayOf', { month: cal.monthName(lang, m.y, m.m) });
  return cal.shortDate(lang, departIso(f));
}

function summaryText(lang, flow, f) {
  const lines = [
    `✈️ ${places.label(f.o)} → ${places.label(f.d)}`,
    f.t === '2' ? `⇄ ${t(lang, 'roundtripShort')}` : `→ ${t(lang, 'onewayShort')}`,
  ];
  let dates = t(lang, 'departOn', { date: whenText(lang, f) });
  if (f.t === '2') {
    if (f.r) dates += ` · ${t(lang, 'returnOn', { date: cal.shortDate(lang, cal.ymdToIso(f.r)) })}`;
    else if (f.n === 'x') dates += ` · ${t(lang, 'returnFlex')}`;
    else if (f.n) dates += ` · ${t(lang, 'returnStay', { n: f.n })}`;
  }
  lines.push(dates);
  if (flow === 'a') {
    lines.push(f.w === 'p' ? t(lang, 'whenDropLine') : t(lang, 'whenDailyLine'));
    if (f.c) lines.push(t(lang, 'ceilingLine', { n: f.c }));
  }
  return lines.join('\n');
}

function placeButtons(lang, flow, f, side, codes) {
  const key = side === 'o' ? 'o' : 'd';
  return codes.map((code) => ({ text: places.label(code), callback_data: nx(flow, { ...f, [key]: code, p: undefined }) }));
}

function pairs(buttons, per = 2) {
  const rows = [];
  for (let i = 0; i < buttons.length; i += per) rows.push(buttons.slice(i, i + per));
  return rows;
}

/** Arma { text, keyboard } del paso que toca. extra = texto antepuesto (errores, avisos). */
function render(lang, flow, input, { now, extra, quota } = {}) {
  const f = clean(input);
  const rm = input && input.rm;
  const step = next(flow, f);
  let text = '';
  let rows = [];
  if (step === 'org') {
    text = t(lang, 'askOrigin');
    rows = pairs(placeButtons(lang, flow, f, 'o', ORIGINS));
    rows.push([{ text: t(lang, 'cancel'), callback_data: cb.encode(flow, 'x') }]);
  } else if (step === 'dst') {
    text = t(lang, 'askDest');
    const all = DESTINATIONS.filter((c) => c !== f.o);
    if (f.p) {
      const per = 8;
      const pages = Math.ceil(all.length / per);
      const page = Math.min(Math.max(0, Number(f.p) - 1), pages - 1);
      rows = pairs(placeButtons(lang, flow, f, 'd', all.slice(page * per, page * per + per)));
      const nav = [];
      if (page > 0) nav.push({ text: '◀', callback_data: nx(flow, { ...f, p: String(page) }) });
      nav.push({ text: `${page + 1}/${pages}`, callback_data: 'noop' });
      if (page + 1 < pages) nav.push({ text: '▶', callback_data: nx(flow, { ...f, p: String(page + 2) }) });
      rows.push(nav);
    } else {
      rows = pairs(placeButtons(lang, flow, f, 'd', places.popular('d').filter((c) => c !== f.o)));
      rows.push([{ text: t(lang, 'seeAll'), callback_data: nx(flow, { ...f, p: '1' }) }]);
    }
    rows.push(navRow(lang, flow, f));
  } else if (step === 'typ') {
    text = t(lang, 'askType');
    rows = [[
      { text: t(lang, 'oneway'), callback_data: nx(flow, { ...f, t: '1' }) },
      { text: t(lang, 'roundtrip'), callback_data: nx(flow, { ...f, t: '2' }) },
    ], navRow(lang, flow, f)];
  } else if (step === 'mon') {
    text = t(lang, 'askDepart');
    rows = cal.monthKeyboard(lang, flow, {}, now).map((row) => row.map((b) => {
      const d = cb.decode(b.callback_data).fields;
      return { text: b.text, callback_data: nx(flow, { ...f, m: d.m, f: d.f }) };
    }));
    rows.push(navRow(lang, flow, f));
  } else if (step === 'day') {
    const m = cal.ym(f.m);
    text = t(lang, 'askDepart');
    rows = cal.dayGrid(lang, m.y, m.m, {
      now,
      min: cal.todayIso(now),
      pick: (dayIso) => nx(flow, { ...f, f: dayIso.slice(8, 10) }),
      nav: (code) => nx(flow, { ...f, m: code }),
      anyDay: nx(flow, { ...f, f: 'x' }),
    });
    rows.push(navRow(lang, flow, f));
  } else if (step === 'ret') {
    text = t(lang, 'askReturn');
    rows = [
      [...STAYS.map((n) => ({ text: t(lang, 'stay', { n }), callback_data: nx(flow, { ...f, n }) })),
        { text: t(lang, 'flexible'), callback_data: nx(flow, { ...f, n: 'x' }) }],
      [{ text: t(lang, 'exactReturn'), callback_data: nx(flow, { ...f, q: '1' }) }],
      navRow(lang, flow, f),
    ];
  } else if (step === 'rday') {
    text = t(lang, 'askReturn');
    const dep = departIso(f);
    const base = dep || `${cal.iso(cal.ym(f.m) ? cal.ym(f.m).y : cal.today(now).y, cal.ym(f.m) ? cal.ym(f.m).m : cal.today(now).m, 1)}`;
    const min = cal.addDays(base, 1);
    const shown = rm && cal.ym(rm) ? cal.ym(rm) : { y: Number(min.slice(0, 4)), m: Number(min.slice(5, 7)) };
    rows = cal.dayGrid(lang, shown.y, shown.m, {
      now,
      min: min > cal.todayIso(now) ? min : cal.todayIso(now),
      pick: (dayIso) => nx(flow, { ...f, q: undefined, r: cal.isoToYmd(dayIso) }),
      nav: (code) => cb.encode(flow, 'rnav', { ...clean(f), rm: code }),
    });
    rows.push(navRow(lang, flow, f));
  } else if (step === 'when') {
    text = t(lang, 'askWhen');
    rows = [[
      { text: t(lang, 'whenDrop'), callback_data: nx(flow, { ...f, w: 'p' }) },
      { text: t(lang, 'whenDaily'), callback_data: nx(flow, { ...f, w: 'd' }) },
    ], navRow(lang, flow, f)];
  } else if (step === 'ceil') {
    text = t(lang, 'askCeiling');
    rows = [navRow(lang, flow, f)];
  } else {
    text = summaryText(lang, flow, f);
    if (quota) text += `\n\n${quota}`;
    const edit = (keys) => {
      const g = { ...f };
      keys.forEach((k) => delete g[k]);
      return nx(flow, g);
    };
    rows = [
      [{ text: t(lang, 'editOrigin'), callback_data: edit(['o']) }, { text: t(lang, 'editDest'), callback_data: edit(['d']) }],
      [{ text: t(lang, 'editDates'), callback_data: edit(['m', 'f', 'r', 'n']) }, { text: t(lang, 'editType'), callback_data: edit(['t', 'r', 'n']) }],
      [{ text: flow === 'a' ? t(lang, 'doAlert') : t(lang, 'doSearch'), callback_data: cb.encode(flow, 'go', f) }],
      [{ text: t(lang, 'cancel'), callback_data: cb.encode(flow, 'x') }],
    ];
  }
  return { step, fields: f, text: extra ? `${extra}\n\n${text}` : text, keyboard: { inline_keyboard: rows } };
}

/**
 * Texto libre en org/dst. Devuelve { fields, extra, choices } donde choices son botones si hay varias.
 */
function applyText(lang, flow, f, text) {
  const step = next(flow, f);
  if (step === 'ceil') {
    const n = Number(String(text).replace(/[^\d]/g, ''));
    if (!Number.isFinite(n) || n < 50 || n > 9999) return { fields: f, extra: t(lang, 'badCeiling') };
    return { fields: { ...f, c: String(n) } };
  }
  if (step !== 'org' && step !== 'dst') return { fields: f, ignored: true };
  const side = step === 'org' ? 'o' : 'd';
  const res = places.match(text, side);
  const pick = (code) => {
    if (side === 'd' && code === f.o) return { fields: f, extra: t(lang, 'sameCity') };
    return { fields: { ...f, [side]: code, p: undefined } };
  };
  if (res.exact) return pick(res.exact);
  if (res.matches.length) {
    const list = res.matches.filter((c) => !(side === 'd' && c === f.o)).slice(0, 6);
    if (list.length === 1) return pick(list[0]);
    if (!list.length) return { fields: f, extra: t(lang, 'sameCity') };
    const extra = res.matches.length > 6 ? `${t(lang, 'pickOne')} ${t(lang, 'typeMore')}` : t(lang, 'pickOne');
    return { fields: f, extra, choices: placeButtons(lang, flow, f, side, list) };
  }
  if (res.uncovered) {
    const inCountry = places.coveredIn(res.uncovered.country, side);
    const list = inCountry.length ? inCountry : places.codesFor(side).slice(0, 6);
    const names = list.map((c) => places.label(c)).join(', ');
    const extra = inCountry.length
      ? t(lang, 'notCovered', { city: res.uncovered.city, country: res.uncovered.country, list: names })
      : t(lang, 'notCoveredAny', { city: res.uncovered.city, list: names });
    return { fields: f, extra, choices: placeButtons(lang, flow, f, side, list) };
  }
  return { fields: f, extra: t(lang, 'notFound', { text: String(text).slice(0, 40) }) };
}

/** Traduce el borrador a la consulta del proveedor. Rango para "cualquier día" y "flexible". */
function toQuery(f, now) {
  const today = cal.todayIso(now);
  let months;
  if (f.m === 'x') {
    const x = cal.today(now);
    months = [0, 1, 2].map((i) => cal.addMonths(x.y, x.m, i)).map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`);
  } else {
    const m = cal.ym(f.m);
    months = [`${m.y}-${String(m.m).padStart(2, '0')}`];
  }
  return {
    origin: f.o,
    destination: f.d,
    months,
    day: departIso(f),
    from: today,
    oneway: f.t !== '2',
    returnDate: f.r ? cal.ymdToIso(f.r) : null,
    stay: f.n && f.n !== 'x' ? Number(f.n) : null,
  };
}

/** Errores de validación que el calendario ya evita, pero se chequean igual del lado del servidor. */
function validate(lang, f, now) {
  if (f.o && f.d && f.o === f.d) return t(lang, 'sameCity');
  const dep = departIso(f);
  if (dep && dep < cal.todayIso(now)) return t(lang, 'expired');
  if (f.r && dep && cal.ymdToIso(f.r) <= dep) return t(lang, 'returnBefore');
  if (f.o && !ORIGINS.includes(f.o)) return t(lang, 'expired');
  if (f.d && !DESTINATIONS.includes(f.d)) return t(lang, 'expired');
  return null;
}

module.exports = { render, next, backFields, applyText, toQuery, validate, summaryText, whenText, departIso, clean, pairs };
