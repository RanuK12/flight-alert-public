'use strict';

const copy = require('../bot/copy');
const { preselect, currencyFor, EU_COUNTRIES } = require('../services/country');
const { renderLanding } = require('./landing');

const pricing = require('../config/pricing');
const entitlements = require('../services/entitlements');
const landing = require('./landing');

function esc(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Misma hoja, tokens y fuentes que la landing.
function layout(title, body, opts = {}) {
  const nonce = opts.nonce ? ` nonce="${esc(opts.nonce)}"` : '';
  const css = `/assets/styles.${landing.hashes.css}.css`;
  return `<!doctype html><html lang="${esc(opts.lang || 'es')}"><head>`
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${opts.fullTitle ? esc(opts.fullTitle) : `${title} | Flight Alert`}</title>${opts.head || ''}`
    + `<script${nonce}>(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();</script>`
    + `<style${nonce}>${landing.criticalCss()}</style>`
    + '<link rel="preload" href="/public/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>'
    + `<link rel="stylesheet" href="${css}">`
    + '</head><body class="page-simple">'
    + '<header class="site-header"><div class="wrap"><a class="wordmark" href="/es"><img class="bot-logo" src="/public/avatar.webp" alt="" width="36" height="36"><span class="wordmark-label">Flight Alert</span></a></div></header>'
    + `<main id="contenido" class="section"><div class="wrap narrow">${body}</div></main>`
    + (opts.script ? `<script${nonce}>${opts.script}</script>` : '')
    + '</body></html>';
}

function home(ctx) {
  const opts = ctx || {};
  return renderLanding({
    lang: opts.lang || 'es',
    region: opts.region || 'other',
    ars: opts.ars || null,
    sample: opts.sample || null,
    nonce: opts.nonce || '',
    base: opts.base || '',
  });
}

/** Países de los hubs LATAM: pagan en USD (Stripe/Stars). MP queda solo para AR. */
const LATAM_COUNTRIES = [['BR', 'Brasil'], ['CL', 'Chile'], ['UY', 'Uruguay'], ['PE', 'Perú'], ['CO', 'Colombia'], ['MX', 'México']];

function countryOptions(suggested) {
  const rows = [['AR', 'Argentina'], ...LATAM_COUNTRIES, ...EU_COUNTRIES, ['OTRO', 'Otro']];
  return rows.map(([code, name]) => (
    `<option value="${code}" ${suggested === code ? 'selected' : ''}>${name}</option>`
  )).join('');
}

function arsLine(ars) {
  if (!ars) return 'Sin cotización del dólar oficial para mostrar el precio en pesos.';
  const n = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(ars);
  return `${n} por mes, al dólar oficial de hoy.`;
}

function priceLines(ars) {
  return {
    ars: arsLine(ars),
    eur: `€${pricing.figure(pricing.PRO_EUR_CENTS, 'es')} por mes, IVA incluido.`,
    usd: `US$${pricing.PRO_USD_CENTS % 100 ? pricing.figure(pricing.PRO_USD_CENTS, 'es') : pricing.PRO_USD_CENTS / 100} por mes.`,
  };
}

function priceKey(code) {
  if (code === 'AR') return 'ars';
  if (EU_COUNTRIES.some(([c]) => c === code)) return 'eur';
  return 'usd';
}

const PRO_SCRIPT = `(function(){
var f=document.getElementById('pro-form');if(!f)return;
var sel=document.getElementById('pro-pais'),out=document.getElementById('pro-price'),em=document.getElementById('pro-email'),err=document.getElementById('pro-email-error');
var eu=(f.getAttribute('data-eu')||'').split(',');
function key(c){return c==='AR'?'ars':(eu.indexOf(c)>=0?'eur':'usd');}
sel.addEventListener('change',function(){out.textContent=out.getAttribute('data-'+key(sel.value));});
function check(){var ok=/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(em.value.trim());err.hidden=ok;em.setAttribute('aria-invalid',ok?'false':'true');return ok;}
em.addEventListener('blur',function(){if(em.value)check();});
f.addEventListener('submit',function(e){if(!check()){e.preventDefault();em.focus();}});
})();`;

const PRO_TEXT = {
  es: {
    b1: 'Búsquedas ilimitadas (uso justo).', b2: 'Te avisamos cuando un precio baja de tu techo.', b3: 'Informe de las 21:00 (hora de Argentina).',
    mp: 'Podés pagar en pesos con Mercado Pago.', noMp: 'El pago en pesos solo aparece si elegís Argentina y estás en Argentina.',
    country: 'País', emailError: 'Escribí un email válido, por ejemplo nombre@dominio.com.',
    btnMp: 'Seguir con Mercado Pago', btnCard: 'Seguir con tarjeta', methods: 'Medios de pago',
    trial: (d) => `Prueba de Pro: ${d} días gratis, una vez por cuenta, desde el bot.`,
  },
  pt: {
    b1: 'Buscas ilimitadas (uso justo).', b2: 'Avisamos quando um preço fica abaixo do seu teto.', b3: 'Relatório das 21:00 (horário da Argentina).',
    mp: 'Você pode pagar em pesos com o Mercado Pago.', noMp: 'O pagamento em pesos só aparece se você escolher Argentina e estiver na Argentina.',
    country: 'País', emailError: 'Digite um email válido, por exemplo nome@dominio.com.',
    btnMp: 'Seguir com Mercado Pago', btnCard: 'Seguir com cartão', methods: 'Formas de pagamento',
    trial: (d) => `Teste do Pro: ${d} dias grátis, uma vez por conta, pelo bot.`,
  },
};

function ptPrices(lines) {
  const tr = (v) => String(v).replace(/ por mes/g, ' por mês').replace(/al dólar oficial de hoy/g, 'ao dólar oficial de hoje')
    .replace(/IVA incluido/g, 'IVA incluído').replace(/Sin cotización del dólar oficial/g, 'Sem cotação do dólar oficial');
  return Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, tr(v)]));
}

/** pt-BR se ?lang=pt, Accept-Language pt* ou país sugerido Brasil. */
function proLang({ lang = '', language = '', country = '' } = {}) {
  if (lang === 'pt' || lang === 'es') return lang;
  const first = String(language || '').split(',')[0].trim().toLowerCase();
  if (first.startsWith('pt') || String(country).toUpperCase() === 'BR') return 'pt';
  return 'es';
}

function pro({ choice = '', ipCountry: geo = '', language = '', nonce = '', ars = null, lang = '' } = {}) {
  const suggested = String(choice || preselect(language) || '').toUpperCase();
  const offer = currencyFor(suggested, geo);
  const L = proLang({ lang, language, country: suggested });
  const raw = priceLines(Number.isInteger(ars) && ars > 0 ? ars : null);
  const lines = L === 'pt' ? ptPrices(raw) : raw;
  const key = priceKey(suggested);
  const t = PRO_TEXT[L];
  const note = offer.rail === 'mp' ? t.mp : t.noMp;
  return layout('Pro', `
    <h1>Pro</h1>
    <ul class="pro-benefits">
      <li>${t.b1}</li>
      <li>${t.b2}</li>
      <li>${t.b3}</li>${require('./aiSoon').li(L)}
    </ul>
    <p class="pro-price" id="pro-price" aria-live="polite" data-ars="${esc(lines.ars)}" data-eur="${esc(lines.eur)}" data-usd="${esc(lines.usd)}">${esc(lines[key])}</p>
    <p class="fine">${note}</p>
    <form class="pro-form" id="pro-form" method="post" action="/pro/checkout" novalidate data-eu="${EU_COUNTRIES.map(([c]) => c).join(',')}">
      <label for="pro-pais">${t.country}</label>
      <select id="pro-pais" name="pais">
        ${countryOptions(suggested)}
      </select>
      <label for="pro-email">Email</label>
      <input id="pro-email" name="email" type="email" autocomplete="email" inputmode="email" required aria-describedby="pro-email-error">
      <p class="form-error" id="pro-email-error" role="alert" hidden>${t.emailError}</p>
      <button class="btn btn--primary pro-submit" type="submit">${offer.rail === 'mp' ? t.btnMp : t.btnCard}</button>
    </form>
    <p class="fine">${t.methods}: ${esc(require('./payMethods').line(L).replace(/\.$/, ''))}.</p>
    <p class="fine">${t.trial(entitlements.TRIAL_DAYS)}</p>
  `, { nonce, script: PRO_SCRIPT, fullTitle: require('./seo').PRO_META.title, head: require('./seo').proHead(), lang: L === 'pt' ? 'pt-BR' : 'es' });
}

function listo(url, opts = {}) {
  const link = url
    ? `<p>Abrí este link en el teléfono (vale 15 minutos, una sola vez): <a href="${url}">${url}</a></p>`
    : '<p>Falta el nombre del bot para armar el link.</p>';
  return layout('Listo', `<h1>Listo</h1>${link}<p>Cuando se acredite el pago, las alertas que tenías pausadas vuelven como estaban.</p>`, { nonce: opts.nonce });
}

function maintenance(opts = {}) {
  return layout('Mantenimiento', `<p>${copy.maintenance}</p>`, { nonce: opts.nonce });
}

module.exports = { home, pro, proLang, listo, maintenance };
