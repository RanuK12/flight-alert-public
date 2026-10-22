'use strict';

const clock = require('../src/utils/clock');
const ai = require('../src/services/ai');
const { validate } = require('../src/services/ai/schema');
const { todayART } = require('../src/services/ai/today');

// 23:30 ART del 22/10 = 02:30 UTC del 23/10.
const LATE = new Date('2026-10-23T02:30:00Z');
const P = [{ name: 'groq' }];
const good = JSON.stringify({ origin: 'COR', destination: 'MAD', departDate: '2026-10-22', returnDate: null, adults: 1 });

beforeEach(() => { ai._reset(); clock.setNow(LATE); process.env.AI_ENABLED = 'true'; });
afterAll(() => { clock.reset(); delete process.env.AI_ENABLED; });

test('todayART a las 23:30 ART sigue siendo el mismo día', () => {
  expect(todayART()).toBe('2026-10-22');
  expect(todayART(new Date('2026-10-23T03:00:00Z'))).toBe('2026-10-23');
});

test('validate acepta "hoy" ART a las 23:30 y rechaza ayer', () => {
  const base = { origin: 'COR', destination: 'MAD' };
  expect(validate({ ...base, departDate: '2026-10-22' }).ok).toBe(true);
  expect(validate({ ...base, departDate: '2026-10-21' }).error).toBe('past');
});

test('prompt y clave de cache usan la fecha ART', async () => {
  const call = jest.fn(async () => ({ content: good, tokens: 1 }));
  const opts = { call, providers: P, isPro: async () => true };
  const out = await ai.parse(1, 'hoy a madrid desde córdoba', opts);
  expect(out.ok).toBe(true);
  expect(call.mock.calls[0][1][0].content).toContain('Hoy es 2026-10-22');
  expect((await ai.parse(1, 'hoy a madrid desde córdoba', opts)).source).toBe('cache');
  clock.setNow(new Date('2026-10-23T03:30:00Z')); // 00:30 ART del 23
  await ai.parse(1, 'hoy a madrid desde córdoba', opts);
  expect(call).toHaveBeenCalledTimes(2);
});
