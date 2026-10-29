'use strict';

const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const ai = require('../src/services/ai');
const providers = require('../src/services/ai/providers');
const { validate } = require('../src/services/ai/schema');
const naturalSearch = require('../src/bot/handlers/naturalSearch');
const buscar = require('../src/bot/handlers/buscar');
const miniapp = require('../src/bot/miniapp');
const ux = require('../src/bot/ux');
const cb = require('../src/bot/ux/cb');

const EMILIO = 9001; // admin + Pro de cortesía (como el usuario del reporte)
const PHRASE = 'quiero ir de córdoba a madrid en marzo, avisame si baja de 900 euros';

function fakeBot() {
  const bot = { sent: [] };
  bot.sendMessage = jest.fn(async (chatId, text, extra) => { bot.sent.push({ chatId, text, extra }); return { message_id: 1 }; });
  bot.editMessageText = jest.fn(async () => true);
  bot.setChatMenuButton = jest.fn(async () => true);
  bot.setMyCommands = jest.fn(async () => true);
  return bot;
}
const msgOf = (id, text, lang = 'es') => ({ chat: { id }, from: { id, language_code: lang }, text });

beforeEach(async () => {
  cleanEnv(); reset(); ai._reset();
  clock.setNow(new Date('2026-10-22T23:27:00Z')); // 20:27 ART, la hora del reporte
  process.env.AI_ENABLED = 'true';
  process.env.GROQ_API_KEY = 'test-groq';
  process.env.ADMIN_TELEGRAM_IDS = String(EMILIO);
  await col('Entitlement').create({ telegramUserId: String(EMILIO), plan: 'pro', source: 'comp', searchesUsed: 0, proUntil: '2099-12-30T00:00:00.000Z' });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => { clock.reset(); cleanEnv(); });

describe('repro prod: frase exacta de Emilio (admin + Pro de cortesía)', () => {
  test('va por la IA, busca COR→MAD en marzo 2027 y ofrece alerta de 900 €', async () => {
    // Contrato nuevo: el modelo devuelve IATA y una fecha que no está en el pasado.
    const call = jest.spyOn(providers, 'callOne').mockResolvedValue({ content: '{"origen":"COR","destino":"MAD","fecha_ida":"2027-03-01","fecha_vuelta":null,"flex_dias":0}', tokens: 60 });
    const reply = jest.spyOn(buscar, 'replySearch').mockResolvedValue(undefined);
    const bot = fakeBot();
    expect(await naturalSearch.handleText(bot, msgOf(EMILIO, PHRASE))).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(bot, EMILIO, EMILIO, expect.objectContaining({ origin: 'COR', destination: 'MAD', departureDate: '2027-03-01' }));
    const offer = bot.sent.find((s) => /900/.test(s.text));
    expect(offer.text).toContain('COR→MAD');
    expect(offer.extra.reply_markup.inline_keyboard[0][0].callback_data).toBe(cb.encode('o', 'al', { o: 'COR', d: 'MAD' }));
  });

  test('providers caídos: no se responde nada de IA, cae al menú (no consume cupo)', async () => {
    jest.spyOn(providers, 'callOne').mockRejectedValue(Object.assign(new Error('x'), { status: 400 }));
    const bot = fakeBot();
    expect(await naturalSearch.handleText(bot, msgOf(EMILIO, PHRASE))).toBe(false);
    expect(bot.sent).toHaveLength(0);
    expect(await require('../src/services/ai/quota').used(EMILIO)).toBe(0);
  });

  test('salida incompleta del modelo: se le vuelve a preguntar al usuario', async () => {
    jest.spyOn(providers, 'callOne').mockResolvedValue({ content: '{"origen":"COR","destino":"MAD","fecha_ida":null,"fecha_vuelta":null,"flex_dias":0}', tokens: 20 });
    const reply = jest.spyOn(buscar, 'replySearch').mockResolvedValue(undefined);
    const bot = fakeBot();
    expect(await naturalSearch.handleText(bot, msgOf(EMILIO, 'córdoba a madrid'))).toBe(true);
    expect(reply).not.toHaveBeenCalled();
    expect(bot.sent[0].text).toMatch(/No me quedó claro/);
  });

  test('Groq: response_format json_object, modelo llama-3.1-8b-instant, sin reasoning_effort', async () => {
    process.env.GROQ_API_KEY = 'x';
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{}' } }], usage: { total_tokens: 1 } }) }));
    await providers.callOne(providers.PROVIDERS[0], [], { json: true, fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.model).toBe('llama-3.1-8b-instant');
    expect(body.reasoning_effort).toBeUndefined();
  });

  test('validate: ciudades → IATA, mes sin día, precio del texto', () => {
    expect(validate({ origin: 'Buenos Aires', destination: 'roma', flexibleMonth: '2026-12' }, { today: '2026-10-22' }).value)
      .toMatchObject({ origin: 'EZE', destination: 'FCO', departDate: '2026-12-01', flexibleMonth: '2026-12' });
    expect(validate({ origin: 'COR', destination: 'MAD', departDate: '2026-10-01', flexibleMonth: '2026-10' }, { today: '2026-10-22' }).value.departDate).toBe('2026-10-22');
    expect(validate({ origin: 'Atlantis', destination: 'MAD', departDate: '2026-12-01' }).ok).toBe(false);
    expect(naturalSearch.priceCeiling(PHRASE)).toBe(900);
    expect(naturalSearch.priceCeiling('menos de 1.200 €')).toBe(1200);
    expect(naturalSearch.priceCeiling('córdoba a madrid')).toBeNull();
  });
});

describe('/start, /pro y teclado para Pro/admin', () => {
  test('/start comp Pro + admin: bienvenida + teclado persistente con Admin + línea Pro + hint admin', async () => {
    const bot = fakeBot();
    await ux.welcome(bot, msgOf(EMILIO, '/start'), { isNew: false });
    const first = bot.sent[0];
    expect(first.text).toContain('Te ayudo a encontrar vuelos');
    expect(first.text).toContain('Tenés Pro');
    expect(first.text).toContain('/admin');
    expect(first.extra.reply_markup).toMatchObject({ is_persistent: true, resize_keyboard: true });
    expect(first.extra.reply_markup.keyboard.flat().map((b) => b.text)).toContain('🛠 Admin');
    expect(bot.sent[1].extra.reply_markup.inline_keyboard).toBeTruthy();
  });

  test('/start usuario común: sin botón Admin', async () => {
    const bot = fakeBot();
    await ux.welcome(bot, msgOf(42, '/start'), { isNew: false });
    expect(bot.sent[0].extra.reply_markup.keyboard.flat().map((b) => b.text)).not.toContain('🛠 Admin');
    expect(bot.sent[0].text).not.toContain('/admin');
  });

  test('/pro comp: estado + teclado, no una línea suelta con 2099', async () => {
    const bot = fakeBot();
    await ux.HANDLERS.pro(bot, msgOf(EMILIO, '/pro'));
    expect(bot.sent[0].text).toMatch(/Tenés Pro activo/);
    expect(bot.sent[0].text).not.toContain('2099');
    expect(bot.sent[0].extra.reply_markup.is_persistent).toBe(true);
  });

  test('keyboard(): variante admin agrega una fila Admin', () => {
    expect(miniapp.keyboard('es', {}).keyboard.flat().map((b) => b.text)).toEqual(['🔎 Buscar vuelo', '🔔 Mis alertas', '📊 Informe', '⭐ Pro', '❓ Ayuda', '⚙️ Ajustes']);
    expect(miniapp.keyboard('es', {}, { admin: true }).keyboard.at(-1)).toEqual([{ text: '🛠 Admin' }]);
  });

  test('botones: van a su handler y nunca a la IA; Admin solo para admins', async () => {
    const parse = jest.spyOn(ai, 'parse');
    const admin = require('../src/bot/admin');
    const adm = jest.spyOn(admin, 'onAdminCommand').mockResolvedValue(undefined);
    const bot = fakeBot();
    for (const a of ['alerts', 'pro', 'help']) {
      const spy = jest.spyOn(ux.HANDLERS, a).mockResolvedValue(undefined);
      expect(await ux.onKeyboard(bot, msgOf(EMILIO, miniapp.KEY_TEXT.es[a]))).toBe(a);
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(await ux.onKeyboard(bot, msgOf(EMILIO, '🛠 Admin'))).toBe('admin');
    expect(adm).toHaveBeenCalledTimes(1);
    expect(await ux.onKeyboard(bot, msgOf(42, '🛠 Admin'))).toBe(false);
    expect(adm).toHaveBeenCalledTimes(1);
    expect(parse).not.toHaveBeenCalled();
  });

  test('startup: menu button web_app a baseUrl()/app y comandos ES/EN', async () => {
    const bot = fakeBot();
    await miniapp.setup(bot, {});
    expect(bot.setChatMenuButton).toHaveBeenCalledWith({ menu_button: JSON.stringify({ type: 'web_app', text: 'Buscar ✈', web_app: { url: 'https://flightalert.ranuk.dev/app' } }) });
    expect(bot.setMyCommands).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ command: 'start' })]));
    expect(bot.setMyCommands).toHaveBeenCalledWith(expect.any(Array), { language_code: 'en' });
  });
});
