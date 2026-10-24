'use strict';

/**
 * Spec PRISM v2 P0.1: botón Menu (Mini App), comandos ES/EN y teclado persistente de abajo.
 * Las llamadas de setup a Telegram (setChatMenuButton, setMyCommands) se hacen desde startBot,
 * o sea solo en el server que corre el bot; los tests usan un bot falso.
 */
const { t } = require('./ux/i18n');
const { baseUrl } = require('../config/site');

/** URL de la Mini App si está lista: base https pública y MINIAPP_ENABLED distinto de "false". */
function miniAppUrl(env = process.env) {
  if (String(env.MINIAPP_ENABLED || 'true').toLowerCase() === 'false') return null;
  const base = baseUrl(env);
  if (!/^https:\/\/[^\s/]+/.test(base)) return null;
  return `${base}/app`;
}

/** Acciones del teclado persistente; cada una va al mismo handler que su comando. */
const ACTIONS = ['search', 'alerts', 'report', 'pro', 'help', 'settings', 'admin'];
const KEY_TEXT = {
  es: { search: '🔎 Buscar vuelo', alerts: '🔔 Mis alertas', report: '📊 Informe', pro: '⭐ Pro', help: '❓ Ayuda', settings: '⚙️ Ajustes', admin: '🛠 Admin' },
  en: { search: '🔎 Search flight', alerts: '🔔 My alerts', report: '📊 Report', pro: '⭐ Pro', help: '❓ Help', settings: '⚙️ Settings', admin: '🛠 Admin' },
  pt: { search: '🔎 Buscar voo', alerts: '🔔 Meus alertas', report: '📊 Relatório', pro: '⭐ Pro', help: '❓ Ajuda', settings: '⚙️ Configurações', admin: '🛠 Admin' },
};
const PLACEHOLDER = { es: 'Escribí una ciudad o tocá un botón', en: 'Type a city or tap a button', pt: 'Escreva uma cidade ou toque em um botão' };

/** Comando equivalente de cada acción (mismo handler). */
const COMMAND_OF = { search: 'buscar', alerts: 'alertas', report: 'informe', pro: 'pro', help: 'ayuda', settings: 'ajustes', admin: 'admin' };

function keyboard(lang, env = process.env, opts = {}) {
  const k = KEY_TEXT[lang] || KEY_TEXT.es;
  const url = miniAppUrl(env);
  const search = url ? { text: k.search, web_app: { url } } : { text: k.search };
  return {
    keyboard: [
      [search],
      [{ text: k.alerts }, { text: k.report }],
      [{ text: k.pro }],
      [{ text: k.help }, { text: k.settings }],
      ...(opts.admin ? [[{ text: k.admin }]] : []),
    ],
    is_persistent: true,
    resize_keyboard: true,
    input_field_placeholder: PLACEHOLDER[lang] || PLACEHOLDER.es,
  };
}

function norm(s) {
  return String(s || '').normalize('NFC').replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Texto de un botón del teclado (ES o EN) → acción, o null. */
function actionFor(text) {
  const n = norm(text);
  for (const lang of Object.keys(KEY_TEXT)) {
    for (const a of ACTIONS) if (norm(KEY_TEXT[lang][a]) === n) return a;
  }
  return null;
}

function menuButton(lang, env = process.env) {
  const url = miniAppUrl(env);
  if (!url) return { type: 'commands' };
  return { type: 'web_app', text: { en: 'Search ✈', pt: 'Buscar voo ✈' }[lang] || 'Buscar ✈', web_app: { url } };
}

/** Comandos visibles: ES por defecto y EN para language_code 'en'. Los alias siguen funcionando. */
const COMMANDS = ['start', 'buscar', 'alertas', 'informe', 'pro', 'ayuda'];
const DESCRIPTIONS = {
  es: { start: 'Inicio y menú', buscar: 'Buscar un vuelo', alertas: 'Ver tus alertas', informe: 'Tu informe de precios', pro: 'Flight Alert Pro', ayuda: 'Ayuda' },
  en: { start: 'Home and menu', buscar: 'Search a flight', alertas: 'Your alerts', informe: 'Your price report', pro: 'Flight Alert Pro', ayuda: 'Help' },
  pt: { start: 'Início e menu', buscar: 'Buscar um voo', alertas: 'Ver seus alertas', informe: 'Seu relatório de preços', pro: 'Flight Alert Pro', ayuda: 'Ajuda' },
};
function commands() {
  const out = {};
  for (const lang of ['es', 'en', 'pt']) out[lang] = COMMANDS.map((c) => ({ command: c, description: DESCRIPTIONS[lang][c] }));
  return out;
}

/** Setup del bot (solo en startBot). Idempotente: setMyCommands/setChatMenuButton reemplazan. */
async function setup(bot, env = process.env) {
  const cmds = commands();
  await bot.setMyCommands(cmds.es).catch(() => {});
  await bot.setMyCommands(cmds.en, { language_code: 'en' }).catch(() => {});
  await bot.setMyCommands(cmds.pt, { language_code: 'pt' }).catch(() => {});
  await bot.setChatMenuButton({ menu_button: JSON.stringify(menuButton('es', env)) }).catch((e) => console.error('setChatMenuButton falló', e && e.message));
}

/** Menú por chat, en el idioma del usuario (se llama en /start). */
async function chatMenu(bot, chatId, lang, env = process.env) {
  if (!bot.setChatMenuButton) return;
  await bot.setChatMenuButton({ chat_id: chatId, menu_button: JSON.stringify(menuButton(lang, env)) }).catch((e) => console.error('setChatMenuButton falló', e && e.message));
}

/** Teclado inline mínimo del home: Buscar (web_app si está lista) + Mis alertas + Pro. */
function homeInline(lang, cbEncode, env = process.env) {
  const url = miniAppUrl(env);
  const search = url ? { text: t(lang, 'btnSearchApp'), web_app: { url } } : { text: t(lang, 'btnSearchApp'), callback_data: cbEncode('b', 'nx') };
  return {
    inline_keyboard: [
      [search],
      [{ text: (KEY_TEXT[lang] || KEY_TEXT.es).alerts, callback_data: cbEncode('m', 'ls') }, { text: (KEY_TEXT[lang] || KEY_TEXT.es).report, callback_data: cbEncode('r', 'go') }],
      [{ text: t(lang, 'btnPro'), callback_data: cbEncode('p', 'show') }],
    ],
  };
}

/** Link directo t.me/<bot>/<short> si BotFather /newapp ya está hecho (MINIAPP_SHORT_NAME). */
function directLink(env = process.env) {
  const bot = String(env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  const short = String(env.MINIAPP_SHORT_NAME || '');
  if (!/^[A-Za-z0-9_]{5,32}$/.test(bot) || !/^[A-Za-z0-9_]{3,30}$/.test(short)) return null;
  return `https://t.me/${bot}/${short}`;
}

module.exports = { directLink, miniAppUrl, keyboard, actionFor, menuButton, commands, setup, chatMenu, homeInline, KEY_TEXT, ACTIONS, COMMAND_OF };
