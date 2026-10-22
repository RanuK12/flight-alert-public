'use strict';
/*
 * Servidor local de la Mini App con datos de ejemplo. Sin secretos de producción:
 * usa la base en memoria, un token de prueba y precios fijos (no llama a Travelpayouts).
 *   node scripts/dev-miniapp.js  → http://localhost:4320/app
 * Imprime un initData firmado con el token de prueba para pegar en el mock.
 */
process.env.NODE_ENV = 'development';
process.env.TELEGRAM_BOT_TOKEN = 'dev:not-a-real-token';
process.env.PUBLIC_BASE_URL = 'https://miniapp.local.test';
process.env.FEATURE_SEARCH = 'on';
process.env.FEATURE_ALERTS = 'on';
delete process.env.MONGODB_URI;
delete process.env.TRAVELPAYOUTS_TOKEN;

const tp = require('../src/providers/travelpayouts');

function fixture({ origin, destination, months, oneway }) {
  const rows = [];
  const seen = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  const now = new Date();
  const ym = (months && months[0]) || `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}`;
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= days; d += 1) {
    if (d % 4 === 2) continue; // días sin dato
    const dep = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ret = oneway ? null : new Date(Date.UTC(y, m - 1, d + 14)).toISOString().slice(0, 10);
    rows.push({ origin, destination, departureDate: dep, returnDate: ret, price: 420 + ((d * 37) % 380), currency: 'EUR', stops: d % 3 === 0 ? 0 : 1, foundAt: seen });
  }
  return rows;
}
tp.searchRange = async (q) => fixture(q);
tp.search = async (q) => fixture(q);

const { col } = require('../src/database');
const { createApp } = require('../src/app');
const initData = require('../src/web/initData');

(async () => {
  const id = '501';
  await col('User').create({ telegramUserId: id, telegramChatId: id, languageCode: 'es', firstName: 'Demo' });
  await col('Route').create({ telegramUserId: id, telegramChatId: id, origin: 'COR', destination: 'MAD', tripType: 'roundtrip', outboundDate: '2026-12-10', returnDate: '2026-12-28', notify: 'drop', priceThreshold: 650, currency: 'EUR', paused: false });
  await col('Route').create({ telegramUserId: id, telegramChatId: id, origin: 'EZE', destination: 'FCO', tripType: 'oneway', outboundDate: '2027-01-15', notify: 'daily', currency: 'EUR', paused: true });
  const port = Number(process.env.PORT || 4320);
  createApp().listen(port, () => {
    const lang = process.env.DEMO_LANG || 'es';
    const auth = initData.sign({ auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'dev', user: JSON.stringify({ id: 501, first_name: 'Demo', language_code: lang }) }, process.env.TELEGRAM_BOT_TOKEN);
    process.stdout.write(`listening ${port}\nINITDATA ${auth}\n`);
  });
})();
