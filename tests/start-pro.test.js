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

async function start(id, lang) {
  const bot = fakeBot();
  await ux.welcome(bot, { chat: { id }, from: { id, language_code: lang } });
  return bot.sent[0];
}

describe('/start con Pro', () => {
  test.each([['es', 'Tenés Pro hasta', 'búsquedas gratis'], ['en', 'You have Pro until', 'free searches']])('Pro con fecha real (%s)', async (lang, yes, no) => {
    await col('Entitlement').create({ telegramUserId: '77', plan: 'pro', source: 'stripe', searchesUsed: 0, proUntil: '2026-12-31T00:00:00.000Z' });
    const msg = await start(77, lang);
    expect(msg).toContain(yes);
    expect(msg).not.toContain(no);
  });

  test.each([['es', 'Tenés Pro:'], ['en', 'You have Pro:']])('comp/admin con año >= 2090 usa helloProOpen (%s)', async (lang, yes) => {
    await col('Entitlement').create({ telegramUserId: '79', plan: 'pro', source: 'comp', searchesUsed: 0, proUntil: '2099-12-31T00:00:00.000Z' });
    const msg = await start(79, lang);
    expect(msg).toContain(yes);
    expect(msg).not.toMatch(/2099/);
  });

  test('Free sigue viendo el cupo', async () => {
    expect(await start(78, 'es')).toContain('búsquedas gratis');
  });
});

describe('Pro con IA · muy pronto', () => {
  test('aparece en la landing y /pro, y se apaga con SHOW_AI_SOON=false', () => {
    const soon = require('../src/web/aiSoon');
    expect(soon.li('es')).toContain('Pro con IA');
    expect(soon.li('en')).toContain('Pro with AI');
    process.env.SHOW_AI_SOON = 'false';
    expect(soon.li('es')).toBe('');
    delete process.env.SHOW_AI_SOON;
  });
});
