'use strict';

const ai = require('../../services/ai');

/**
 * P3: ayuda libre para Pro/admin cuando el texto no era una búsqueda ni nada del menú.
 * Devuelve true si respondió; si no, false y el bot muestra el menú de siempre (ux.notUnderstood).
 */
async function handleText(bot, msg) {
  if (msg.aiCapped || !ai.helpEnabled()) return false;
  const userId = msg.from && msg.from.id;
  const out = await ai.help(userId, msg.text);
  if (!out.ok) return false;
  const ux = require('../ux');
  const { langOf } = require('../ux/i18n');
  await bot.sendMessage(msg.chat.id, out.text, { reply_markup: ux.menu(langOf(msg.from)) });
  return true;
}

module.exports = { handleText };
