'use strict';

const axios = require('axios');
const { col } = require('../database');
const clock = require('../utils/clock');
const logger = require('../utils/logger').child('fx');

const DAY_MS = 24 * 60 * 60 * 1000;

let fetchers = {
  async bna() {
    const res = await axios.get('https://www.bna.com.ar/Personas', {
      timeout: 8000,
      headers: { 'User-Agent': 'flight-alert-public' },
    });
    return parseBnaVenta(res.data);
  },
  async dolarapi() {
    const res = await axios.get('https://dolarapi.com/v1/dolares/oficial', { timeout: 8000 });
    const n = Number(res.data && res.data.venta);
    if (!Number.isFinite(n) || n <= 0) throw new Error('dolarapi sin venta');
    return n;
  },
};

function setFetchers(next) {
  fetchers = { ...fetchers, ...next };
}

function arsPrice(rate) {
  return Math.ceil((5 * rate) / 100) * 100;
}

function parseBnaVenta(html) {
  const text = String(html);
  const block = text.match(/D[oó]lar U\.S\.A[\s\S]{0,400}/i);
  if (!block) throw new Error('bna sin fila de dolar');
  const nums = [...block[0].matchAll(/(\d{1,3}(?:\.\d{3})*,\d{2}|\d{3,5}(?:[.,]\d{1,2})?)/g)]
    .map((m) => m[1]);
  if (nums.length < 2) throw new Error('bna sin venta');
  return parseArsNumber(nums[1]);
}

function parseArsNumber(raw) {
  const s = String(raw).trim();
  if (s.includes(',') && s.includes('.')) {
    return Number(s.replace(/\./g, '').replace(',', '.'));
  }
  if (s.includes(',')) return Number(s.replace(',', '.'));
  return Number(s);
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
  parseBnaVenta,
  refresh,
  latest,
  setFetchers,
  adjustSubscriptions,
};
