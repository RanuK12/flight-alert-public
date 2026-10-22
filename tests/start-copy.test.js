'use strict';
const entitlements = require('../src/services/entitlements');
const ux = require('../src/bot/ux');
const { STRINGS } = require('../src/bot/ux/i18n');

function fakeBot() {
  const sent = [];
  return { sent, sendMessage: async (chatId, text) => { sent.push(text); } };
}

describe('/start muestra el cupo Free desde la config', () => {
  const cap = entitlements.SEARCH_CAP;
  afterEach(() => { entitlements.SEARCH_CAP = cap; });

  test('el saludo no tiene números fijos', () => {
    for (const lang of ['es', 'en']) {
      expect(STRINGS[lang].hello).toContain('{n}');
      expect(STRINGS[lang].hello).toContain('{days}');
      expect(STRINGS[lang].hello).not.toMatch(/\b1 (búsqueda|free search)\b/);
    }
  });

  test.each([['es', 'Tenés 10 búsquedas gratis por mes y 7 días'], ['en', 'You get 10 free searches a month and a 7-day trial']])('%s: 10 por mes', async (lang, expected) => {
    expect(entitlements.SEARCH_CAP).toBe(10);
    const bot = fakeBot();
    await ux.welcome(bot, { chat: { id: 1 }, from: { id: 1, language_code: lang } });
    expect(bot.sent[0]).toContain(expected);
  });

  test('el número sale de entitlements.SEARCH_CAP', async () => {
    entitlements.SEARCH_CAP = 23;
    const bot = fakeBot();
    await ux.welcome(bot, { chat: { id: 1 }, from: { id: 1, language_code: 'es' } });
    expect(bot.sent[0]).toContain('Tenés 23 búsquedas gratis por mes');
  });
});
