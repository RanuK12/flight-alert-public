'use strict';

const LIVE_STRIPE = 'sk_' + 'live';
const TEST_STRIPE = 'sk_' + 'test';
const LIVE_MP = 'APP_' + 'USR-';
const TEST_MP = 'TEST-';

function paymentsMode() {
  const raw = String(process.env.PAYMENTS_MODE || 'test').trim().toLowerCase();
  if (raw !== 'test' && raw !== 'live') {
    throw new Error('PAYMENTS_MODE debe ser test o live');
  }
  return raw;
}

function assertStripeKey(key) {
  const mode = paymentsMode();
  const value = String(key || '');
  const ok = mode === 'live' ? value.startsWith(LIVE_STRIPE) : value.startsWith(TEST_STRIPE);
  if (!ok) {
    throw new Error(mode === 'live'
      ? 'STRIPE_SECRET_KEY no coincide con PAYMENTS_MODE=live'
      : 'STRIPE_SECRET_KEY debe ser de test');
  }
}

/**
 * MP ahora entrega credenciales de prueba con el mismo prefijo que live (cuentas de prueba).
 * Solo en PAYMENTS_MODE=test y con MP_TEST_USER=1 explícito se aceptan; en live no cambia nada.
 */
function mpTestPrefixOk(value) {
  if (value.startsWith(TEST_MP)) return true;
  return process.env.MP_TEST_USER === '1' && value.startsWith(LIVE_MP);
}

function assertMpKey(token) {
  const mode = paymentsMode();
  const value = String(token || '');
  const ok = mode === 'live' ? value.startsWith(LIVE_MP) : mpTestPrefixOk(value);
  if (!ok) {
    throw new Error(mode === 'live'
      ? 'MP_ACCESS_TOKEN no coincide con PAYMENTS_MODE=live'
      : 'MP_ACCESS_TOKEN debe ser de test');
  }
}

function keyMatches(value, mode, livePrefix, testPrefix) {
  if (!value) return true;
  return mode === 'live' ? String(value).startsWith(livePrefix) : String(value).startsWith(testPrefix);
}

/**
 * Arranque: una clave presente tiene que ser del mismo modo.
 * Sin clave, ese riel no está configurado y no falla.
 * En live, Stripe además exige precios y el secreto de webhook de live.
 */
function assertConfigured() {
  const mode = paymentsMode();
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const mpToken = process.env.MP_ACCESS_TOKEN || '';
  if (!keyMatches(stripeKey, mode, LIVE_STRIPE, TEST_STRIPE)) {
    throw new Error(mode === 'live'
      ? 'STRIPE_SECRET_KEY no coincide con PAYMENTS_MODE=live'
      : 'STRIPE_SECRET_KEY debe ser de test');
  }
  const mpOk = !mpToken || (mode === 'live' ? mpToken.startsWith(LIVE_MP) : mpTestPrefixOk(mpToken));
  if (!mpOk) {
    throw new Error(mode === 'live'
      ? 'MP_ACCESS_TOKEN no coincide con PAYMENTS_MODE=live'
      : 'MP_ACCESS_TOKEN debe ser de test');
  }
  if (mode === 'live' && stripeKey) {
    if (!process.env.STRIPE_PRICE_EUR) throw new Error('STRIPE_PRICE_EUR missing');
    if (!process.env.STRIPE_PRICE_USD) throw new Error('STRIPE_PRICE_USD missing');
    if (!process.env.STRIPE_WEBHOOK_SECRET_LIVE) throw new Error('STRIPE_WEBHOOK_SECRET_LIVE missing');
  }
}

module.exports = {
  paymentsMode,
  assertStripeKey,
  assertMpKey,
  assertConfigured,
};

/** Verificación opcional: la cuenta del token es de prueba (tag test_user en /users/me). */
module.exports.isMpTestUser = async function isMpTestUser(token, get) {
  const res = await get('https://api.mercadopago.com/users/me', {
    timeout: 8000,
    headers: { Authorization: `Bearer ${token}` },
  });
  const tags = (res && res.data && res.data.tags) || [];
  return tags.includes('test_user');
};
