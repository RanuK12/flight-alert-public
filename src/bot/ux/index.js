'use strict';

const webSession = require('../../web/webSession');

/** Controlador del panel único (spec UX v1). Un mensaje por flujo que se edita en cada paso. */
const clock = require('../../utils/clock');
const logger = require('../../utils/logger').child('ux');
const { col } = require('../../database');
const flags = require('../../config/flags');
const sessions = require('../sessions');
const entitlements = require('../../services/entitlements');
const { runSearch } = require('../../services/search');
const stars = require('../../services/payments/stars');
const fx = require('../../services/fx');
const cb = require('./cb');
const cal = require('./calendar');
const flow = require('./flow');
const results = require('./results');
const places = require('./places');
const { t, langOf } = require('./i18n');

const TTL = 30 * 60 * 1000;
const SEARCH_CAP = 10;
const MAX_RETRY = 3;
let sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setSleeper(fn) { sleep = fn; }

/** Edita el panel si lo hay; si no (o si Telegram no deja), manda uno nuevo. */
async function show(bot, chatId, mid, text, keyboard) {
  const extra = keyboard ? { reply_markup: keyboard } : {};
  if (mid) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: mid, ...extra });
      return mid;
    } catch (err) {
      if (/not modified/i.test(String(err && err.message))) return mid;
    }
  }
  const sent = await bot.sendMessage(chatId, text, extra);
  return sent && sent.message_id;
}

async function saveDraft(chatId, userId, data) {
  await sessions.setSession(chatId, { userId, state: 'ux', data, ttlMs: TTL });
}

async function quotaLine(lang, userId) {
  if (flags.isOwner(userId) || await entitlements.isPro(userId)) return { ok: true, text: '' };
  const gate = await entitlements.peek(userId);
  if (gate.owner) return { ok: true, text: '' };
  const left = Math.max(0, SEARCH_CAP - (gate.used || 0));
  if (left > 0) return { ok: true, text: t(lang, 'quotaLeft', { n: left }) };
  const x = cal.today();
  const nm = cal.addMonths(x.y, x.m, 1);
  return { ok: false, text: t(lang, 'quotaOut', { date: cal.shortDate(lang, cal.iso(nm.y, nm.m, 1)) }) };
}

async function step(bot, ctx, fl, fields, extra) {
  const now = clock.now();
  const err = flow.validate(ctx.lang, fields, now);
  let f = fields;
  let note = extra;
  if (err) {
    note = err;
    if (err === t(ctx.lang, 'returnBefore')) { f = { ...fields }; delete f.r; }
    else if (err === t(ctx.lang, 'sameCity')) { f = { ...fields }; delete f.d; }
    else return expired(bot, ctx);
  }
  let quota = '';
  if (fl === 'b' && flow.next(fl, f) === 'sum') {
    const q = await quotaLine(ctx.lang, ctx.userId);
    quota = q.text;
  }
  const view = flow.render(ctx.lang, fl, f, { now, extra: note, quota });
  const mid = await show(bot, ctx.chatId, ctx.mid, view.text, view.keyboard);
  await saveDraft(ctx.chatId, ctx.userId, { flow: fl, fields: view.fields, mid, lang: ctx.lang, editId: ctx.editId || null });
  return view;
}

async function expired(bot, ctx) {
  await show(bot, ctx.chatId, ctx.mid, t(ctx.lang, 'expired'), {
    inline_keyboard: [[{ text: t(ctx.lang, 'restart'), callback_data: cb.encode('b', 'nx') }]],
  });
  return null;
}

function menu(lang) {
  return {
    inline_keyboard: [
      [{ text: t(lang, 'btnSearch'), callback_data: cb.encode('b', 'nx') }, { text: t(lang, 'btnAlert'), callback_data: cb.encode('a', 'nx') }],
      [{ text: t(lang, 'btnPro'), callback_data: cb.encode('p', 'show') }, { text: t(lang, 'btnHelp'), callback_data: cb.encode('s', 'help') }],
    ],
  };
}

/** Atajo "/buscar cor mad dic": resuelve lo que puede y salta esos pasos. */
function shortcut(args) {
  const words = String(args || '').trim().split(/\s+/).filter(Boolean);
  const f = {};
  if (words[0]) { const r = places.match(words[0], 'o'); if (r.exact) f.o = r.exact; }
  if (words[1] && f.o) { const r = places.match(words[1], 'd'); if (r.exact && r.exact !== f.o) f.d = r.exact; }
  if (words[2] && f.d) {
    const w = places.norm(words[2]).slice(0, 3);
    const idx = ['es', 'en'].map((l) => t(l, 'monthsShort').map((m) => places.norm(m))).map((list) => list.indexOf(w)).find((i) => i >= 0);
    if (idx !== undefined) {
      const hit = cal.months().find((m) => m.m === idx + 1);
      if (hit) f.m = cal.ymCode(hit.y, hit.m);
    }
  }
  return f;
}

async function startFlow(bot, msg, fl, fields = {}, editId = null) {
  const ctx = { chatId: msg.chat.id, userId: msg.from.id, lang: langOf(msg.from), mid: null, editId };
  if (fl === 'a') {
    const opened = await require('../handlers/nuevaAlerta').gate(ctx.userId, ctx.chatId);
    if (!opened.ok) return proScreen(bot, ctx, opened.text);
    return step(bot, ctx, fl, fields, opened.text);
  }
  return step(bot, ctx, fl, fields);
}

async function doSearch(bot, ctx, f, attempt) {
  const lang = ctx.lang;
  if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
  await show(bot, ctx.chatId, ctx.mid, t(lang, 'searching'));
  const now = clock.now();
  const res = await runSearch(ctx.userId, flow.toQuery(f, now));
  const again = { inline_keyboard: [[{ text: t(lang, 'alertThisRoute'), callback_data: cb.encode('a', 'nx', { o: f.o, d: f.d, t: f.t }) }, { text: t(lang, 'newSearch'), callback_data: cb.encode('b', 'nx') }]] };
  if (res.apiError) {
    const rows = attempt + 1 < MAX_RETRY ? [[{ text: t(lang, 'retry'), callback_data: cb.encode('b', 'go', { ...f, k: String(attempt + 1) }) }]] : [];
    rows.push([{ text: t(lang, 'cancel'), callback_data: cb.encode('b', 'x') }]);
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'apiError'), { inline_keyboard: rows });
    return res;
  }
  if (res.paywall) return proScreen(bot, ctx, (await quotaLine(lang, ctx.userId)).text);
  if (res.status !== 200) {
    await show(bot, ctx.chatId, ctx.mid, res.text, again);
    return res;
  }
  const view = results.render(lang, res.results || [], now);
  if (!view.shown.length) {
    const g = { ...f };
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'empty', { o: f.o, d: f.d, when: flow.whenText(lang, f) }), {
      inline_keyboard: [[
        { text: t(lang, 'changeDates'), callback_data: cb.encode('b', 'nx', flow.clean({ ...g, m: undefined, f: undefined, r: undefined, n: undefined })) },
        { text: t(lang, 'changeDest'), callback_data: cb.encode('b', 'nx', flow.clean({ ...g, d: undefined })) },
      ]],
    });
    return res;
  }
  await show(bot, ctx.chatId, ctx.mid, view.text, { inline_keyboard: [...view.buttons, ...again.inline_keyboard] });
  await sessions.clearSession(ctx.chatId);
  return res;
}

async function createAlert(bot, ctx, f) {
  const nuevaAlerta = require('../handlers/nuevaAlerta');
  const opened = await nuevaAlerta.gate(ctx.userId, ctx.chatId);
  if (!opened.ok) return proScreen(bot, ctx, opened.text);
  const now = clock.now();
  const q = flow.toQuery(f, now);
  const first = q.day || (q.months[0] === cal.todayIso(now).slice(0, 7) ? cal.todayIso(now) : `${q.months[0]}-01`);
  const doc = {
    telegramUserId: String(ctx.userId),
    telegramChatId: String(ctx.chatId),
    origin: f.o,
    destination: f.d,
    tripType: f.t === '2' ? 'roundtrip' : 'oneway',
    outboundDate: first,
    returnDate: q.returnDate || (q.stay ? cal.addDays(first, q.stay) : null),
    flexMonth: f.m === 'x' ? 'next3' : (f.f === 'x' ? q.months[0] : null),
    stayDays: q.stay,
    notify: f.w === 'p' ? 'drop' : 'daily',
    priceThreshold: f.c ? Number(f.c) : null,
    currency: 'EUR',
    hour: '21:00',
    paused: false,
    name: `${f.o}→${f.d}`,
  };
  if (ctx.editId) {
    await col('Route').updateOne({ _id: ctx.editId, telegramUserId: String(ctx.userId) }, { $set: doc });
  } else {
    await col('Route').create(doc);
  }
  await sessions.clearSession(ctx.chatId);
  const extra = opened.text ? `\n\n${opened.text}` : '';
  await show(bot, ctx.chatId, ctx.mid, `${t(ctx.lang, ctx.editId ? 'alertUpdated' : 'alertCreated')}${extra}`);
  return doc;
}

async function proScreen(bot, ctx, extra) {
  const lang = ctx.lang;
  const e = await col('Entitlement').findOne({ telegramUserId: String(ctx.userId) });
  if (await entitlements.isPro(ctx.userId) && e && e.proUntil) {
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'alreadyPro', { date: cal.shortDate(lang, cal.todayIso(new Date(e.proUntil))) }));
    return null;
  }
  const last = await fx.latest().catch(() => null);
  const ars = last && last.publishedArs ? t(lang, 'proArs', { ars: Number(last.publishedArs).toLocaleString('es-AR') }) : '';
  const base = String(process.env.PUBLIC_BASE_URL || 'https://flight-alert-public.onrender.com').replace(/\/$/, '');
  const text = [extra, t(lang, 'proTitle'), t(lang, 'proPrices', { ars }), t(lang, 'proHow')].filter(Boolean).join('\n\n');
  const rows = [[{ text: t(lang, 'payWeb'), url: `${base}/pro?s=${encodeURIComponent(webSession.sign(ctx.userId))}` }]];
  if (flags.stars()) rows.push([{ text: t(lang, 'payStars'), callback_data: cb.encode('p', 'stars') }]);
  await show(bot, ctx.chatId, ctx.mid, text, { inline_keyboard: rows });
  return null;
}

function alertLabel(lang, r) {
  const m = r.outboundDate ? t(lang, 'monthsShort')[Number(String(r.outboundDate).slice(5, 7)) - 1].toLowerCase() : '';
  return `${r.origin}→${r.destination} · ${m} · ${r.tripType === 'roundtrip' ? '⇄' : '→'}${r.paused ? ` · ${t(lang, 'paused')}` : ''}`;
}

async function alerts(bot, ctx, stepName, fields) {
  const lang = ctx.lang;
  const mine = { telegramUserId: String(ctx.userId) };
  const routes = await col('Route').find(mine).lean();
  const byId = (id) => routes.find((r) => String(r._id) === String(id));
  if (stepName === 'ls') {
    if (!routes.length) {
      await show(bot, ctx.chatId, ctx.mid, t(lang, 'noAlerts'), { inline_keyboard: [[{ text: t(lang, 'newAlert'), callback_data: cb.encode('a', 'nx') }]] });
      return;
    }
    const pages = Math.ceil(routes.length / 5);
    const p = Math.min(Math.max(0, Number(fields.p || 0)), pages - 1);
    const rows = routes.slice(p * 5, p * 5 + 5).map((r) => [{ text: alertLabel(lang, r), callback_data: cb.encode('m', 'dt', { id: String(r._id) }) }]);
    if (pages > 1) {
      const nav = [];
      if (p > 0) nav.push({ text: '◀', callback_data: cb.encode('m', 'ls', { p: String(p - 1) }) });
      nav.push({ text: `${p + 1}/${pages}`, callback_data: 'noop' });
      if (p + 1 < pages) nav.push({ text: '▶', callback_data: cb.encode('m', 'ls', { p: String(p + 1) }) });
      rows.push(nav);
    }
    rows.push([{ text: t(lang, 'newAlert'), callback_data: cb.encode('a', 'nx') }]);
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'yourAlerts', { n: routes.length }), { inline_keyboard: rows });
    return;
  }
  const r = byId(fields.id);
  if (!r) return alerts(bot, ctx, 'ls', {});
  const id = String(r._id);
  if (stepName === 'pa') {
    if (r.paused && !(await entitlements.canUseAlerts(ctx.userId))) return proScreen(bot, ctx, require('../copy').alertsPaywall);
    await col('Route').updateOne({ _id: r._id, ...mine }, { $set: r.paused ? { paused: false, pausedByBilling: false } : { paused: true } });
    return alerts(bot, ctx, 'dt', { id });
  }
  if (stepName === 'dl') {
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'confirmDel', { o: r.origin, d: r.destination }), {
      inline_keyboard: [[{ text: t(lang, 'yesDel'), callback_data: cb.encode('m', 'dk', { id }) }, { text: t(lang, 'no'), callback_data: cb.encode('m', 'dt', { id }) }]],
    });
    return;
  }
  if (stepName === 'dk') {
    await col('Route').deleteMany({ _id: r._id, ...mine });
    await show(bot, ctx.chatId, ctx.mid, t(lang, 'deleted', { o: r.origin, d: r.destination }), {
      inline_keyboard: [[{ text: t(lang, 'back'), callback_data: cb.encode('m', 'ls') }]],
    });
    return;
  }
  if (stepName === 'ed') {
    const f = { o: r.origin, d: r.destination, t: r.tripType === 'roundtrip' ? '2' : '1' };
    if (r.outboundDate) { f.m = cal.ymCode(Number(r.outboundDate.slice(0, 4)), Number(r.outboundDate.slice(5, 7))); f.f = r.flexMonth ? 'x' : r.outboundDate.slice(8, 10); }
    if (r.flexMonth === 'next3') { f.m = 'x'; f.f = 'x'; }
    if (f.t === '2') { if (r.stayDays) f.n = String(r.stayDays); else if (r.returnDate) f.r = cal.isoToYmd(r.returnDate); else f.n = 'x'; }
    f.w = r.notify === 'drop' ? 'p' : 'd';
    if (r.priceThreshold) f.c = String(r.priceThreshold);
    return step(bot, { ...ctx, editId: id }, 'a', f);
  }
  const head = alertLabel(lang, r);
  const state = r.paused ? t(lang, 'paused') : t(lang, 'active');
  await show(bot, ctx.chatId, ctx.mid, `${head}\n${state}`, {
    inline_keyboard: [
      [
        { text: r.paused ? t(lang, 'resume') : t(lang, 'pause'), callback_data: cb.encode('m', 'pa', { id }) },
        { text: t(lang, 'edit'), callback_data: cb.encode('m', 'ed', { id }) },
        { text: t(lang, 'del'), callback_data: cb.encode('m', 'dl', { id }) },
      ],
      [{ text: t(lang, 'back'), callback_data: cb.encode('m', 'ls') }],
    ],
  });
}

async function report(bot, msg) {
  const lang = langOf(msg.from);
  const routes = await col('Route').find({ telegramUserId: String(msg.from.id) }).lean();
  const ready = routes.some((r) => !r.paused && r.lastPriceEur && r.foundAt);
  if (!ready) {
    await bot.sendMessage(msg.chat.id, t(lang, 'noReport'), routes.length ? undefined : { reply_markup: { inline_keyboard: [[{ text: t(lang, 'newAlert'), callback_data: cb.encode('a', 'nx') }]] } });
    return { empty: true };
  }
  return require('../handlers/informe').sendInforme(bot, msg.chat.id, msg.from.id);
}

/** callback_query del bot. Devuelve true si era de la UX v1 (o un botón vencido). */
async function onCallback(bot, cq) {
  const parsed = cb.decode(cq.data);
  if (!parsed.ok && !parsed.stale) return false;
  await bot.answerCallbackQuery(cq.id, {}).catch(() => {});
  if (parsed.noop) return true;
  const msg = cq.message || {};
  const chatId = msg.chat && msg.chat.id;
  const ctx = { chatId, userId: cq.from.id, lang: langOf(cq.from), mid: msg.message_id };
  const draft = await sessions.getSession(chatId);
  if (draft && draft.state === 'ux' && draft.data && draft.data.mid === ctx.mid) ctx.editId = draft.data.editId || null;
  try {
    if (!parsed.ok) { await expired(bot, ctx); return true; }
    const { flow: fl, step: s, fields } = parsed;
    if (s === 'x') {
      await sessions.clearSession(chatId);
      await show(bot, chatId, ctx.mid, t(ctx.lang, 'cancelled'));
      return true;
    }
    if (fl === 'b' || fl === 'a') {
      if (s === 'nx' || s === 'rnav') {
        if (fl === 'a' && !fields.o && !draft) {
          const opened = await require('../handlers/nuevaAlerta').gate(ctx.userId, chatId);
          if (!opened.ok) { await proScreen(bot, ctx, opened.text); return true; }
        }
        await step(bot, ctx, fl, fields);
        return true;
      }
      if (s === 'go') {
        const f = flow.clean(fields);
        if (flow.next(fl, f) !== 'sum' || flow.validate(ctx.lang, f, clock.now())) { await expired(bot, ctx); return true; }
        if (fl === 'b') await doSearch(bot, ctx, f, Math.min(Number(fields.k || 0), MAX_RETRY - 1));
        else await createAlert(bot, ctx, f);
        return true;
      }
    }
    if (fl === 'm') { await alerts(bot, ctx, s, fields); return true; }
    if (fl === 'p') {
      if (s === 'stars') await stars.sendInvoice(bot, chatId, ctx.userId);
      else await proScreen(bot, ctx);
      return true;
    }
    if (fl === 's' && s === 'help') { await show(bot, chatId, ctx.mid, t(ctx.lang, 'help'), menu(ctx.lang)); return true; }
    await expired(bot, ctx);
  } catch (err) {
    logger.error('callback ux', err);
  }
  return true;
}

/** Texto libre dentro de un flujo (ciudad o techo de precio). */
async function onText(bot, msg) {
  const draft = await sessions.getSession(msg.chat.id);
  if (!draft || draft.state !== 'ux') return false;
  const d = draft.data || {};
  const ctx = { chatId: msg.chat.id, userId: msg.from.id, lang: d.lang || langOf(msg.from), mid: d.mid, editId: d.editId };
  const res = flow.applyText(ctx.lang, d.flow, d.fields || {}, msg.text);
  if (res.ignored) return false;
  if (res.choices) {
    const rows = flow.pairs(res.choices);
    rows.push([{ text: t(ctx.lang, 'cancel'), callback_data: cb.encode(d.flow, 'x') }]);
    await show(bot, ctx.chatId, ctx.mid, res.extra, { inline_keyboard: rows });
    return true;
  }
  await step(bot, ctx, d.flow, res.fields, res.extra);
  return true;
}

async function welcome(bot, msg) {
  const lang = langOf(msg.from);
  await bot.sendMessage(msg.chat.id, t(lang, 'hello'), { reply_markup: menu(lang) });
}

async function notUnderstood(bot, msg) {
  const lang = langOf(msg.from);
  await bot.sendMessage(msg.chat.id, t(lang, 'notUnderstood'), { reply_markup: menu(lang) });
}

function register(bot) {
  bot.onText(/^\/(?:buscar|search)(?:@\w+)?(?:\s+(.*))?$/, async (msg, match) => {
    const args = (match && match[1]) || '';
    if (/\d{4}-\d{2}-\d{2}/.test(args)) return; // formato viejo con fecha exacta: lo atiende handlers/buscar
    await startFlow(bot, msg, 'b', shortcut(args));
  });
  bot.onText(/^\/(?:nueva_alerta|new_alert)(?:@\w+)?$/, (msg) => startFlow(bot, msg, 'a'));
  bot.onText(/^\/(?:mis_alertas|my_alerts)(?:@\w+)?$/, (msg) => alerts(bot, { chatId: msg.chat.id, userId: msg.from.id, lang: langOf(msg.from), mid: null }, 'ls', {}));
  bot.onText(/^\/(?:informe|report)(?:@\w+)?$/, (msg) => report(bot, msg));
  bot.onText(/^\/pro(?:@\w+)?$/, (msg) => proScreen(bot, { chatId: msg.chat.id, userId: msg.from.id, lang: langOf(msg.from), mid: null }));
}

function commands() {
  const { STRINGS } = require('./i18n');
  return {
    es: Object.entries(STRINGS.es.cmd).map(([command, description]) => ({ command, description })),
    en: Object.entries(STRINGS.en.cmd).map(([command, description]) => ({ command, description })),
  };
}

module.exports = {
  register, onCallback, onText, welcome, notUnderstood, startFlow, shortcut, commands, setSleeper, menu, proScreen, alerts, report,
};
