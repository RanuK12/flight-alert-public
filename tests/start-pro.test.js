'use strict';
const { cleanEnv } = require('./helpers');
const clock = require('../src/utils/clock');
const { reset, col } = require('../src/database');
const ux = require('../src/bot/ux');

function fakeBot() {
  const sent = [];
  return { sent, sendMessage: async (chatId, text) => { sent.push(text); }, setChatMenuButton: async () => true };
}

beforeEach(() => { cleanEnv(); reset(); clock.reset(); clock.setNow(new Date('2026-10-22T12:00:00Z')); });

describe('/start con Pro (comp)', () => {
  test.each([['es', 'Tenés Pro hasta', 'búsquedas gratis'], ['en', 'You have Pro until', 'free searches']])('%s', async (lang, yes, no) => {
    await col('Entitlement').create({ telegramUserId: '77', plan: 'pro', source: 'comp', searchesUsed: 0, proUntil: '2099-12-31T00:00:00.000Z' });
    const bot = fakeBot();
    await ux.welcome(bot, { chat: { id: 77 }, from: { id: 77, language_code: lang } });
    expect(bot.sent[0]).toContain(yes);
    expect(bot.sent[0]).not.toContain(no);
  });

  test('Free sigue viendo el cupo', async () => {
    const bot = fakeBot();
    await ux.welcome(bot, { chat: { id: 78 }, from: { id: 78, language_code: 'es' } });
    expect(bot.sent[0]).toContain('búsquedas gratis');
  });
});
