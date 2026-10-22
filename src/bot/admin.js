'use strict';

/**
 * Modo admin oculto del bot. Solo IDs en ADMIN_TELEGRAM_IDS (env). No figura en setMyCommands.
 * Un no admin recibe la respuesta normal de "no entendí" y no ve nada.
 * Acciones peligrosas (kill switch, dar/sacar Pro) piden confirmación con botón.
 * Todo queda en la colección AdminAudit.
 */

const crypto = require('crypto');
const flags = require('../config/flags');
const { col, health } = require('../database');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const runtimeFlags = require('../services/runtimeFlags');
const rateLimit = require('../services/rateLimit');

const log = logger.child('admin-bot');
const PREFIX = 'adm:';
const CONFIRM_TTL_MS = 5 * 60 * 1000;
const LOG_LINES = 15;
const COMP_UNTIL = '2099-12-31T00:00:00.000Z';
const pending = new Map();

async function audit(adminId, action, target = null, status = 'done') {
  try {
    await col('AdminAudit').create({ adminId: String(adminId), action, target: target === null ? null : String(target), status, at: clock.now().toISOString() });
  } catch (err) { log.error('audit', err); }
}

function menu() {
  const k = flags.kill();
  const ia = flags.instantAlerts();
  return {
    inline_keyboard: [
      [{ text: '📊 Estado', callback_data: `${PREFIX}status` }, { text: '👥 Usuarios y pagos', callback_data: `${PREFIX}counts` }],
      [{ text: k ? '🟢 Apagar kill switch' : '🔴 Kill switch', callback_data: `${PREFIX}ask:kill:${k ? 'off' : 'on'}` }],
      [{ text: `⚡ Alertas instantáneas: ${ia ? 'ON → OFF' : 'OFF → ON'}`, callback_data: `${PREFIX}ia:${ia ? 'off' : 'on'}` }],
      [{ text: '🔁 Forzar chequeo de precios', callback_data: `${PREFIX}price` }, { text: '📜 Logs', callback_data: `${PREFIX}logs` }],
    ],
  };
}

const HELP = 'Admin. Pro de cortesía: /admin pro <telegramId> · sacar: /admin unpro <telegramId>';

async function statusText() {
  const h = health();
  const w = require('./transport').webhookInfo();
  return [
    'Estado',
    `server: ${h.ok ? 'ok' : 'falla'} · db: ${h.db}`,
    `commit: ${(process.env.RENDER_GIT_COMMIT || 'unknown').slice(0, 12)} · uptime: ${Math.round(process.uptime())} s`,
    `webhook: ${w.url ? 'registrado' : 'sin url'} · pendientes: ${w.pending ?? 's/d'} · último error: ${w.lastError ? 'sí' : 'no'}`,
    `kill: ${flags.kill() ? 'ON' : 'off'} · alertas instantáneas: ${flags.instantAlerts() ? 'ON' : 'off'}`,
  ].join('\n');
}

async function countsText() {
  const c = await require('../web/admin').counts();
  const p = c.paymentsToday;
  return `Usuarios: ${c.users.total} · Free ${c.users.free} · Pro ${c.users.pro} · Prueba ${c.users.trial}\nPagos hoy: Stripe ${p.stripe} · MP ${p.mp} · Stars ${p.stars}\n(sin admins ni owners)`;
}

function ask(bot, chatId, adminId, action, target, label) {
  const nonce = crypto.randomBytes(6).toString('hex');
  pending.set(nonce, { adminId: String(adminId), action, target, exp: clock.now().getTime() + CONFIRM_TTL_MS });
  return bot.sendMessage(chatId, `¿Confirmás? ${label}`, {
    reply_markup: { inline_keyboard: [[{ text: '✅ Confirmar', callback_data: `${PREFIX}ok:${nonce}` }, { text: '✖️ Cancelar', callback_data: `${PREFIX}no:${nonce}` }]] },
  });
}

async function execute(action, target) {
  if (action === 'kill:on' || action === 'kill:off') {
    await runtimeFlags.set('kill', action.endsWith('on') ? 'on' : 'off');
    return `Kill switch ${flags.kill() ? 'ON' : 'off'}.`;
  }
  if (action === 'grantPro') {
    await require('../services/entitlements').ensure(target);
    await col('Entitlement').updateOne({ telegramUserId: String(target) }, {
      $set: { plan: 'pro', source: 'comp', provider: 'comp', proUntil: COMP_UNTIL, graceUntil: null, expiryNoticeAt: null },
    });
    return `Pro de cortesía activo para ${target}.`;
  }
  if (action === 'revokePro') {
    await require('../services/entitlements').downgrade(target);
    return `Pro sacado a ${target}.`;
  }
  return 'Acción desconocida.';
}

async function onAdminCommand(bot, msg, args) {
  const chatId = msg.chat.id;
  const adminId = msg.from.id;
  const parts = String(args || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 2 && ['pro', 'unpro'].includes(parts[0]) && /^\d{1,20}$/.test(parts[1])) {
    const grant = parts[0] === 'pro';
    await audit(adminId, grant ? 'grantPro:asked' : 'revokePro:asked', parts[1], 'pending');
    return ask(bot, chatId, adminId, grant ? 'grantPro' : 'revokePro', parts[1], grant ? `Dar Pro de cortesía a ${parts[1]}` : `Sacar Pro a ${parts[1]}`);
  }
  await audit(adminId, 'menu');
  return bot.sendMessage(chatId, HELP, { reply_markup: menu() });
}

function register(bot) {
  bot.onText(/^\/admin(?:@\w+)?(?:\s+(.*))?$/, async (msg, match) => {
    try {
      if (!flags.isAdmin(msg.from && msg.from.id)) {
        // Para un no admin, /admin no existe: misma respuesta que cualquier cosa que no entendemos.
        return require('./ux').notUnderstood(bot, msg);
      }
      await onAdminCommand(bot, msg, match && match[1]);
    } catch (err) { log.error('admin', err); }
  });
}

/** Devuelve true si el callback era del menú admin (consumido). */
async function onCallback(bot, cq) {
  const data = String(cq.data || '');
  if (!data.startsWith(PREFIX)) return false;
  const answer = (text) => bot.answerCallbackQuery(cq.id, text ? { text } : {}).catch(() => {});
  const adminId = cq.from && cq.from.id;
  if (!flags.isAdmin(adminId)) { await answer(); return true; }
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  const [, cmd, a, b] = data.split(':');
  await answer();
  try {
    if (cmd === 'status') { await audit(adminId, 'status'); await bot.sendMessage(chatId, await statusText()); return true; }
    if (cmd === 'counts') { await audit(adminId, 'counts'); await bot.sendMessage(chatId, await countsText()); return true; }
    if (cmd === 'logs') {
      await audit(adminId, 'logs');
      const lines = logger.recent(LOG_LINES).map((l) => logger.scrub(l));
      await bot.sendMessage(chatId, lines.length ? lines.join('\n').slice(-3500) : 'Sin logs.');
      return true;
    }
    if (cmd === 'ia' && (a === 'on' || a === 'off')) {
      await runtimeFlags.set('instantAlerts', a);
      await audit(adminId, `instantAlerts:${a}`);
      await bot.sendMessage(chatId, `Alertas instantáneas ${flags.instantAlerts() ? 'ON' : 'off'}.`, { reply_markup: menu() });
      return true;
    }
    if (cmd === 'price') {
      if (rateLimit.limited('admin-price', 'all', 2, 10 * 60 * 1000)) {
        await audit(adminId, 'priceCheck', null, 'rate_limited');
        await bot.sendMessage(chatId, 'El chequeo corrió hace poco. Probá en unos minutos.');
        return true;
      }
      await audit(adminId, 'priceCheck');
      const out = await require('../services/instantAlerts').run(bot, { force: true });
      await bot.sendMessage(chatId, `Chequeo forzado: ${JSON.stringify(out || {}).slice(0, 500)}`);
      return true;
    }
    if (cmd === 'ask' && a === 'kill' && (b === 'on' || b === 'off')) {
      await audit(adminId, `kill:${b}:asked`, null, 'pending');
      await ask(bot, chatId, adminId, `kill:${b}`, null, b === 'on' ? 'Prender el kill switch (bot en mantenimiento)' : 'Apagar el kill switch');
      return true;
    }
    if (cmd === 'ok' || cmd === 'no') {
      const p = pending.get(a);
      pending.delete(a);
      if (!p || p.adminId !== String(adminId) || p.exp < clock.now().getTime()) {
        await bot.sendMessage(chatId, 'La confirmación venció. Volvé a pedirla.');
        return true;
      }
      if (cmd === 'no') { await audit(adminId, p.action, p.target, 'cancelled'); await bot.sendMessage(chatId, 'Cancelado.'); return true; }
      const text = await execute(p.action, p.target);
      await audit(adminId, p.action, p.target, 'done');
      log.warn('admin action', { action: p.action });
      await bot.sendMessage(chatId, text, { reply_markup: menu() });
      return true;
    }
  } catch (err) {
    log.error('admin callback', err);
    await audit(adminId, cmd || 'unknown', null, 'error');
  }
  return true;
}

function resetPending() { pending.clear(); }

module.exports = { register, onCallback, audit, menu, PREFIX, resetPending, _pending: pending };
