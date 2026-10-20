'use strict';

const axios = require('axios');
const { col } = require('../database');
const clock = require('../utils/clock');
const logger = require('../utils/logger').child('fx');

const DAY_MS = 24 * 60 * 60 * 1000;

async function readOficial() {
  const res = await axios.get('https://dolarapi.com/v1/dolares/oficial', { timeout: 8000 });
  const n = Number(res.data && res.data.venta);
  if (!Number.isFinite(n) || n <= 0) throw new Error('dolarapi sin venta');
  return n;
}

const defaultFetchers = {
  async bna() {
    return readOficial();
  },
  async dolarapi() {
    return readOficial();
  },
};

let fetchers = { ...defaultFetchers };

function setFetchers(next) {
  fetchers = { ...fetchers, ...next };
}

function resetFetchers() {
  fetchers = { ...defaultFetchers };
}

function arsPrice(rate) {
  return Math.ceil((5 * rate) / 100) * 100;
}

async function latest() {
  const rows = await col('FxRate').find({}).lean();
  return rows.sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1) || null;
}

async function refresh() {
  let rate = null;
  let source = null;
  try {
    rate = await fetchers.bna();
    source = 'bna';
  } catch {
    try {
      rate = await fetchers.dolarapi();
      source = 'dolarapi';
    } catch {
      logger.warn('FX sin fuentes, queda la última tasa');
      const last = await latest();
      return {
        rate: last ? last.usedRate : null,
        ars: last ? last.publishedArs : null,
        stale: true,
      };
    }
  }
  const spot = arsPrice(rate);
  const last = await latest();
  let publishedArs = spot;
  let publishedRate = rate;
  if (last && last.publishedRate) {
    const delta = Math.abs(rate - last.publishedRate) / last.publishedRate;
    if (delta <= 0.03) {
      publishedArs = last.publishedArs;
      publishedRate = last.publishedRate;
    }
  }
  await col('FxRate').create({
    usedRate: rate,
    source,
    spotArs: spot,
    publishedArs,
    publishedRate,
    at: clock.now().toISOString(),
  });
  return { rate, ars: publishedArs, source, stale: false };
}

/**
 * Una vez por mes, avisa 7 días antes y después actualiza el preapproval.
 * El PUT es el de la documentación de Mercado Pago:
 * https://api.mercadopago.com/preapproval/{id}
 */
async function adjustSubscriptions(updateAmount) {
  const last = await latest();
  if (!last) return { adjusted: 0 };
  const subs = await col('Entitlement').find({ plan: 'pro', provider: 'mp' }).lean();
  const now = clock.now();
  let adjusted = 0;
  for (const sub of subs) {
    const anchor = sub.lastAdjustAt ? new Date(sub.lastAdjustAt).getTime() : 0;
    const monthGone = !sub.lastAdjustAt || (now.getTime() - anchor) >= 30 * DAY_MS;
    if (!monthGone) continue;
    if (!sub.noticeSentAt) {
      await col('Entitlement').updateOne(
        { telegramUserId: sub.telegramUserId },
        { $set: { noticeSentAt: now.toISOString(), pendingArs: last.publishedArs } },
      );
      continue;
    }
    const waited = now.getTime() - new Date(sub.noticeSentAt).getTime();
    if (waited < 7 * DAY_MS) continue;
    if (typeof updateAmount === 'function') {
      await updateAmount(sub.providerRef, last.publishedArs);
    }
    await col('Entitlement').updateOne(
      { telegramUserId: sub.telegramUserId },
      { $set: { lastAdjustAt: now.toISOString(), noticeSentAt: null, priceCurrency: 'ARS' } },
    );
    adjusted += 1;
  }
  return { adjusted };
}

module.exports = {
  arsPrice,
  refresh,
  latest,
  setFetchers,
  resetFetchers,
  adjustSubscriptions,
};
