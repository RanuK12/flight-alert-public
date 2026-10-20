'use strict';

const { col } = require('../database');
const clock = require('../utils/clock');

const TTL_MS = 20 * 60 * 1000;

async function getSession(chatId) {
  const doc = await col('BotSession').findOne({ chatId: String(chatId) });
  if (!doc) return null;
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() <= clock.now().getTime()) {
    await clearSession(chatId);
    return null;
  }
  return doc;
}

async function setSession(chatId, input) {
  const expiresAt = new Date(clock.now().getTime() + (input.ttlMs || TTL_MS)).toISOString();
  await col('BotSession').updateOne(
    { chatId: String(chatId) },
    {
      $set: {
        userId: input.userId == null ? null : String(input.userId),
        state: input.state,
        data: input.data || {},
        expiresAt,
      },
    },
    { upsert: true },
  );
}

async function clearSession(chatId) {
  await col('BotSession').deleteMany({ chatId: String(chatId) });
}

module.exports = { getSession, setSession, clearSession, TTL_MS };
