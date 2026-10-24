'use strict';

const instant = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID;
let sleeper = instant ? async () => {} : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nextByChat = new Map();
let nextGlobal = 0;

function setSleeper(fn) {
  sleeper = fn;
}

async function waitTurn(chatId) {
  const now = Date.now();
  const chatAt = nextByChat.get(String(chatId)) || 0;
  const at = Math.max(now, chatAt, nextGlobal);
  if (at > now) await sleeper(at - now);
  const sent = Date.now();
  nextByChat.set(String(chatId), sent + 1000);
  nextGlobal = sent + 40;
}

async function send(bot, chatId, text, extra) {
  await waitTurn(chatId);
  return bot.sendMessage(chatId, text, extra);
}

/** Documento (Buffer) con el mismo turno por chat que los mensajes. */
async function sendDocument(bot, chatId, buffer, options, fileOptions) {
  await waitTurn(chatId);
  return bot.sendDocument(chatId, buffer, options, fileOptions);
}

module.exports = { send, sendDocument, setSleeper, waitTurn };
