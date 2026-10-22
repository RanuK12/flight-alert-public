'use strict';

jest.mock('../src/providers/travelpayouts', () => ({ search: jest.fn(), searchRange: jest.fn() }));

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const rateLimit = require('../src/services/rateLimit');
const travelpayouts = require('../src/providers/travelpayouts');
const cb = require('../src/bot/ux/cb');
const cal = require('../src/bot/ux/calendar');
const flow = require('../src/bot/ux/flow');
const places = require('../src/bot/ux/places');
const results = require('../src/bot/ux/results');
const ux = require('../src/bot/ux');
const { STRINGS, t } = require('../src/bot/ux/i18n');
const { ORIGINS, DESTINATIONS } = require('../src/config/airports');

const NOW = new Date('2026-10-22T15:00:00Z'); // 22/10/2026 12:00 ART

function fakeBot() {
  const bot = { sent: [], edits: [], answers: [], n: 100 };
  bot.sendMessage = jest.fn(async (chatId, text, extra) => { bot.n += 1; bot.sent.push({ chatId, text, extra, id: bot.n }); return { message_id: bot.n }; });
  bot.editMessageText = jest.fn(async (text, extra) => { bot.edits.push({ text, extra }); return true; });
  bot.answerCallbackQuery = jest.fn(async (id) => { bot.answers.push(id); });
  bot.last = () => (bot.edits.length ? bot.edits[bot.edits.length - 1] : bot.sent[bot.sent.length - 1]);
  bot.keys = () => { const l = bot.last(); return ((l.extra && l.extra.reply_markup && l.extra.reply_markup.inline_keyboard) || []).flat(); };
  bot.button = (re) => bot.keys().find((b) => re.test(b.text));
  return bot;
}
const from = { id: 501, language_code: 'es' };
const chat = { id: 501 };
let mid = 0;
async function tap(bot, data, user = from) {
  return ux.onCallback(bot, { id: `cq${Math.random()}`, data, from: user, message: { chat, message_id: mid } });
}
async function say(bot, text, user = from) {
  return ux.onText(bot, { chat, from: user, text });
}
function allCallbacks(kb) { return kb.inline_keyboard.flat().filter((b) => b.callback_data).map((b) => b.callback_data); }

beforeEach(() => {
  cleanEnv(); reset(); rateLimit.reset(); clock.setNow(NOW);
  process.env.FEATURE_SEARCH = 'on';
  process.env.FEATURE_ALERTS = 'on';
  travelpayouts.searchRange.mockReset();
  ux.setSleeper(async () => {});
  mid = 0;
});
afterEach(() => { clock.reset(); cleanEnv(); });

describe('1. callback_data ≤ 64 bytes', () => {
  test('peor caso de cada flujo y de cada pantalla', () => {
    const worst = { o: 'MDQ', d: 'MAD', t: '2', m: '2612', f: '15', r: '270105', w: 'p', c: '9999' };
    for (const fl of ['b', 'a']) {
      const states = [{}, { o: 'EZE' }, { o: 'EZE', p: '4' }, { o: 'EZE', d: 'MAD' }, { o: 'EZE', d: 'MAD', t: '2' },
        { o: 'EZE', d: 'MAD', t: '2', m: '2612' }, { o: 'EZE', d: 'MAD', t: '2', m: '2612', f: '15' },
        { o: 'EZE', d: 'MAD', t: '2', m: '2612', f: '15', q: '1' }, { ...worst, w: undefined, c: undefined }, worst, { ...worst, c: undefined }];
      for (const s of states) {
        const view = flow.render('es', fl, s, { now: NOW });
        for (const data of allCallbacks(view.keyboard)) expect(Buffer.byteLength(data)).toBeLessThanOrEqual(64);
      }
    }
    expect(Buffer.byteLength(cb.encode('b', 'go', { ...worst, k: '2' }))).toBeLessThanOrEqual(64);
    expect(Buffer.byteLength(cb.encode('m', 'dk', { id: 'a'.repeat(24) }))).toBeLessThanOrEqual(64);
    expect(() => cb.encode('b', 'nx', { x: 'y'.repeat(70) })).toThrow();
  });
});

describe('2. Atrás y Cancelar', () => {
  test('Atrás vuelve exactamente al paso anterior con los datos previos', () => {
    const seq = [{}, { o: 'COR' }, { o: 'COR', d: 'MAD' }, { o: 'COR', d: 'MAD', t: '2' }, { o: 'COR', d: 'MAD', t: '2', m: '2612' },
      { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15' }, { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', n: '14' }];
    for (let i = 1; i < seq.length; i += 1) expect(flow.backFields('b', seq[i])).toEqual(seq[i - 1]);
    expect(flow.backFields('b', { o: 'COR', d: 'MAD', t: '1', m: 'x', f: 'x' })).toEqual({ o: 'COR', d: 'MAD', t: '1' });
    expect(flow.backFields('b', { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', q: '1' })).toEqual({ o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15' });
    expect(flow.backFields('a', { o: 'COR', d: 'MAD', t: '1', m: '2612', f: '15', w: 'd' })).toEqual({ o: 'COR', d: 'MAD', t: '1', m: '2612', f: '15' });
  });
  test('Cancelar está en todos los pasos y borra el borrador', async () => {
    const states = [{}, { o: 'COR' }, { o: 'COR', d: 'MAD' }, { o: 'COR', d: 'MAD', t: '2' }, { o: 'COR', d: 'MAD', t: '2', m: '2612' },
      { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15' }, { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', q: '1' }, { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', n: '7' }];
    for (const s of states) expect(allCallbacks(flow.render('es', 'b', s, { now: NOW }).keyboard)).toContain('v1|b|x');
    const bot = fakeBot();
    await ux.startFlow(bot, { chat, from }, 'b');
    mid = bot.sent[0].id;
    await tap(bot, 'v1|b|x');
    expect(bot.last().text).toBe('Listo, cancelé. Cuando quieras, /buscar.');
    expect(await col('BotSession').findOne({ chatId: String(chat.id) })).toBeNull();
  });
});

describe('3. Matching de ciudades', () => {
  test.each([['cordoba', 'COR'], ['CÓRDOBA', 'COR'], ['COR', 'COR'], ['cba', 'COR']])('origen %s → %s', (q, code) => {
    expect(places.match(q, 'o').exact).toBe(code);
  });
  test('"madrd" (typo) encuentra Madrid como destino', () => {
    expect(places.match('madrd', 'd').exact).toBe('MAD');
  });
  test('ciudad no cubierta muestra las cubiertas del país', () => {
    const r = flow.applyText('es', 'b', {}, 'Mendoza');
    expect(r.extra).toMatch(/Todavía no cubrimos Mendoza\. Desde Argentina cubrimos: /);
    expect(r.choices.map((b) => cb.decode(b.callback_data).fields.o).every((c) => ORIGINS.includes(c))).toBe(true);
  });
  test('sin coincidencia y origen = destino', () => {
    expect(flow.applyText('es', 'b', {}, 'zzzzqq').extra).toBe('No encontré «zzzzqq». Probá con otra forma de escribirlo o con el código de 3 letras.');
    expect(flow.applyText('en', 'b', {}, 'zzzzqq').extra).toMatch(/^I couldn’t find/);
  });
  test('nunca ofrece una ruta fuera de las 5×31', () => {
    for (const q of ['paris', 'london', 'buenos aires', 'mendoza', 'mad', 'ro']) {
      for (const side of ['o', 'd']) {
        const f = side === 'o' ? {} : { o: 'EZE' };
        const r = flow.applyText('es', 'b', f, q);
        const codes = [r.fields[side], ...(r.choices || []).map((b) => cb.decode(b.callback_data).fields[side])].filter(Boolean);
        codes.forEach((c) => expect((side === 'o' ? ORIGINS : DESTINATIONS)).toContain(c));
      }
    }
  });
});

describe('4. Calendario', () => {
  test('no deja días pasados y marca hoy', () => {
    const rows = cal.dayGrid('es', 2026, 10, { min: cal.todayIso(NOW), pick: (d) => `p${d}`, nav: (c) => `n${c}`, now: NOW });
    const days = rows.slice(2).flat();
    expect(days.find((b) => b.text === '•22').callback_data).toBe('p2026-10-22');
    expect(days.filter((b) => b.text === '·')).toHaveLength(21);
    expect(days.filter((b) => b.callback_data.startsWith('p'))).toHaveLength(10);
  });
  test('meses de 28 a 31 días y cambio de año', () => {
    expect(cal.daysIn(2027, 2)).toBe(28);
    expect(cal.daysIn(2028, 2)).toBe(29);
    expect(cal.daysIn(2026, 11)).toBe(30);
    expect(cal.addMonths(2026, 12, 1)).toEqual({ y: 2027, m: 1 });
    const list = cal.months(NOW);
    expect(list).toHaveLength(12);
    expect(list[0]).toEqual({ y: 2026, m: 10 });
    expect(list[11]).toEqual({ y: 2027, m: 9 });
    expect(cal.months(new Date('2026-10-30T15:00:00Z'))[0]).toEqual({ y: 2026, m: 11 });
  });
  test('vuelta: los días hasta la ida están deshabilitados y una vuelta anterior se rechaza', () => {
    const view = flow.render('es', 'b', { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', q: '1' }, { now: NOW });
    const picks = allCallbacks(view.keyboard).filter((d) => /;r=\d{6}/.test(d)).map((d) => cb.decode(d).fields.r);
    expect(picks[0]).toBe('261216');
    expect(flow.validate('es', { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', r: '261210' }, NOW)).toBe('La vuelta tiene que ser después de la ida.');
  });
  test('"cualquier día" y "flexible" llegan a la API como rango', () => {
    const q = flow.toQuery({ o: 'COR', d: 'MAD', t: '2', m: '2612', f: 'x', n: 'x' }, NOW);
    expect(q).toMatchObject({ months: ['2026-12'], day: null, returnDate: null, stay: null, oneway: false });
    const any = flow.toQuery({ o: 'COR', d: 'MAD', t: '1', m: 'x', f: 'x' }, NOW);
    expect(any.months).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(any.from).toBe('2026-10-22');
    expect(flow.toQuery({ o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', n: '14' }, NOW)).toMatchObject({ day: '2026-12-15', stay: 14 });
  });
});

test('5. Editar un campo del resumen no borra los demás y vuelve al resumen', () => {
  const full = { o: 'COR', d: 'MAD', t: '2', m: '2612', f: '15', n: '14' };
  const view = flow.render('es', 'b', full, { now: NOW });
  expect(view.step).toBe('sum');
  expect(view.text).toBe('✈️ Córdoba (COR) → Madrid (MAD)\n⇄ Ida y vuelta\nIda: 15 dic 2026 · Vuelta: 14 días después');
  const editDest = cb.decode(view.keyboard.inline_keyboard[0][1].callback_data).fields;
  expect(editDest).toEqual({ o: 'COR', t: '2', m: '2612', f: '15', n: '14' });
  const pick = flow.render('es', 'b', editDest, { now: NOW }).keyboard.inline_keyboard[0][0];
  const after = cb.decode(pick.callback_data).fields;
  expect(flow.next('b', after)).toBe('sum');
  expect(after).toMatchObject({ o: 'COR', t: '2', m: '2612', f: '15', n: '14' });
});

describe('6–7. Resultados, deep-links y cuota', () => {
  const row = (o, d, dep, ret, price, hoursAgo) => ({ origin: o, destination: d, departureDate: dep, returnDate: ret, price, currency: 'EUR', stops: 1, foundAt: new Date(NOW.getTime() - hoursAgo * 3600e3).toISOString() });
  test.each([['COR', 'MAD', '2026-12-15', '2026-12-29'], ['EZE', 'FCO', '2027-01-10', null], ['ROS', 'BCN', '2026-11-03', '2026-11-17']])('%s→%s: "visto hace", aviso de caché y deep-link con parámetros', (o, d, dep, ret) => {
    process.env.TRAVELPAYOUTS_MARKER = '123456';
    const v = results.render('es', [row(o, d, dep, ret, 612, 3), row(o, d, dep, ret, 700, 0.5), row(o, d, dep, ret, 650, 30), row(o, d, dep, ret, 500, 24 * 8)], NOW);
    expect(v.shown.map((x) => x.price)).toEqual([612, 650, 700]);
    expect(v.text).toContain('Visto hace 3 h');
    expect(v.text).toContain('Visto hace menos de 1 h');
    expect(v.text).toContain('Visto hace 1 días');
    expect(v.text).toContain('Son precios en caché, vistos hace unas horas.');
    const ddmm = (s) => `${s.slice(8, 10)}${s.slice(5, 7)}`;
    const url = new URL(v.buttons[0][0].url);
    expect(url.pathname).toBe(`/search/${o}${ddmm(dep)}${d}${ret ? ddmm(ret) : ''}1`);
    expect(url.searchParams.get('marker')).toBe('123456');
  });
  test('la cuota baja solo con una búsqueda exitosa; un error de API no consume y ofrece Reintentar', async () => {
    const bot = fakeBot();
    const used = async () => ((await col('Entitlement').findOne({ telegramUserId: '501' })) || {}).searchesUsed || 0;
    const go = cb.encode('b', 'go', { o: 'COR', d: 'MAD', t: '1', m: '2612', f: 'x' });
    travelpayouts.searchRange.mockRejectedValueOnce(new Error('timeout'));
    await tap(bot, go);
    expect(bot.last().text).toBe('No pude traer precios ahora. Probá en unos minutos.');
    expect(bot.button(/Reintentar/).callback_data).toContain('k=1');
    expect(await used()).toBe(0);
    rateLimit.reset();
    travelpayouts.searchRange.mockResolvedValueOnce([row('COR', 'MAD', '2026-12-15', null, 612, 3)]);
    await tap(bot, bot.button(/Reintentar/).callback_data);
    expect(bot.last().text).toContain('💸 € 612 · solo ida');
    expect(await used()).toBe(1);
    rateLimit.reset();
    travelpayouts.searchRange.mockResolvedValueOnce([]);
    await tap(bot, cb.encode('b', 'go', { o: 'COR', d: 'BCN', t: '1', m: '2612', f: 'x' }));
    expect(bot.last().text).toBe('No encontré precios guardados para COR → BCN en cualquier día de diciembre 2026. Probá con otro mes o con fechas flexibles.');
    expect(await used()).toBe(1);
  });
  test('el resumen muestra cuántas búsquedas quedan', async () => {
    const bot = fakeBot();
    await tap(bot, cb.encode('b', 'nx', { o: 'COR', d: 'MAD', t: '1', m: '2612', f: '15' }));
    expect(bot.last().text).toContain('Te quedan 10 búsquedas este mes.');
  });
});

describe('8. Panel único y botones viejos', () => {
  test('cada paso edita el mismo mensaje', async () => {
    const bot = fakeBot();
    await ux.startFlow(bot, { chat, from }, 'b');
    mid = bot.sent[0].id;
    await say(bot, 'cordoba');
    await say(bot, 'madrd');
    await tap(bot, bot.button(/Ida y vuelta/).callback_data);
    expect(bot.sent).toHaveLength(1);
    expect(bot.edits.every((e) => e.extra.message_id === mid)).toBe(true);
    expect(bot.last().text).toBe('¿Cuándo salís?');
  });
  test('botón viejo responde "Este botón venció" y siempre se contesta el callback', async () => {
    const bot = fakeBot();
    for (const data of ['v0|b|nx', 'route:pause:abc', 'v1|b|go|o=EZE']) {
      await tap(bot, data);
      expect(bot.last().text).toBe('Este botón venció, empezá de nuevo.');
    }
    expect(bot.answers).toHaveLength(3);
  });
});

test('9. ES y EN completos', () => {
  const es = Object.keys(STRINGS.es).sort();
  expect(Object.keys(STRINGS.en).sort()).toEqual(es);
  for (const k of es) {
    const a = STRINGS.es[k]; const b = STRINGS.en[k];
    expect(typeof a).toBe(typeof b);
    if (Array.isArray(a)) expect(a).toHaveLength(b.length);
  }
  expect(() => t('es', 'noExiste')).toThrow();
});

test('nueva alerta: pasos, techo y confirmación', async () => {
  const bot = fakeBot();
  await ux.startFlow(bot, { chat, from }, 'a');
  mid = bot.sent[0].id;
  await tap(bot, cb.encode('a', 'nx', { o: 'COR', d: 'MAD', t: '1', m: '2612', f: '15' }));
  expect(bot.last().text).toBe('¿Cuándo te aviso?');
  await tap(bot, bot.button(/Cuando baje/).callback_data);
  await say(bot, 'abc');
  expect(bot.last().text).toMatch(/^Necesito un número/);
  await say(bot, '650');
  expect(bot.last().text).toContain('Techo: €650');
  await tap(bot, bot.button(/Crear alerta/).callback_data);
  expect(bot.last().text).toMatch(/^Listo, te aviso por acá/);
  const route = await col('Route').findOne({ telegramUserId: '501' });
  expect(route).toMatchObject({ origin: 'COR', destination: 'MAD', outboundDate: '2026-12-15', priceThreshold: 650, notify: 'drop' });
});

test('/mis_alertas: detalle, pausar y borrar con confirmación', async () => {
  const bot = fakeBot();
  await col('Route').create({ telegramUserId: '501', origin: 'COR', destination: 'MAD', tripType: 'roundtrip', outboundDate: '2026-12-15', paused: false });
  const ctx = { chatId: chat.id, userId: 501, lang: 'es', mid: null };
  await ux.alerts(bot, ctx, 'ls', {});
  expect(bot.button(/COR→MAD · dic · ⇄/)).toBeTruthy();
  mid = bot.sent[0].id;
  await tap(bot, bot.button(/COR→MAD/).callback_data);
  await tap(bot, bot.button(/Pausar/).callback_data);
  expect(bot.button(/Reanudar/)).toBeTruthy();
  await tap(bot, bot.button(/Borrar/).callback_data);
  expect(bot.last().text).toBe('¿Borro la alerta COR → MAD?');
  await tap(bot, bot.button(/Sí, borrar/).callback_data);
  expect(await col('Route').find({ telegramUserId: '501' }).lean()).toHaveLength(0);
});

test('/buscar cor mad dic salta los pasos resueltos; EN usa su copia', async () => {
  expect(ux.shortcut('cor mad dic')).toEqual({ o: 'COR', d: 'MAD', m: '2612' });
  const bot = fakeBot();
  await ux.startFlow(bot, { chat, from: { id: 9, language_code: 'en' } }, 'b', ux.shortcut('cor mad'));
  expect(bot.last().text).toBe('One-way or round trip?');
});
