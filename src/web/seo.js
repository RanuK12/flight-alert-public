'use strict';

const routes = require('../../data/seo-routes.json');
const landing = require('./landing');
const clock = require('../utils/clock');
const { isFresh, seenLabel } = require('../services/sortFlights');

const DEFAULT_BASE = 'https://flightalert.ranuk.dev';
const HTML_CACHE = 'public, max-age=300, stale-while-revalidate=86400';

function baseUrl() {
  return String(process.env.PUBLIC_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, '');
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function slugify(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function names(h1, lang) {
  const m = lang === 'en' ? /^Flights from (.+) to (.+)$/.exec(h1) : /^Vuelos de (.+) a (.+)$/.exec(h1);
  if (!m) throw new Error(`h1 inesperado: ${h1}`);
  return [m[1], m[2]];
}

const ROUTES = routes.map((r) => {
  const [oEs, dEs] = names(r.es.h1, 'es');
  const [oEn, dEn] = names(r.en.h1, 'en');
  return {
    ...r,
    from: { es: oEs, en: oEn },
    to: { es: dEs, en: dEn },
    path: { es: `/vuelos/${slugify(oEs)}-${slugify(dEs)}`, en: `/en/flights/${slugify(oEn)}-${slugify(dEn)}` },
  };
});

/** Rutas Europa↔Europa/LatAm retiradas (no son cobertura AR→EU): 301 a la home del idioma. */
const REMOVED = new Set(["/vuelos/madrid-paris", "/en/flights/madrid-paris", "/vuelos/madrid-roma", "/en/flights/madrid-rome", "/vuelos/madrid-lisboa", "/en/flights/madrid-lisbon", "/vuelos/madrid-londres", "/en/flights/madrid-london", "/vuelos/barcelona-paris", "/en/flights/barcelona-paris", "/vuelos/barcelona-roma", "/en/flights/barcelona-rome", "/vuelos/madrid-amsterdam", "/en/flights/madrid-amsterdam", "/vuelos/madrid-milan", "/en/flights/madrid-milan", "/vuelos/malaga-londres", "/en/flights/malaga-london", "/vuelos/madrid-berlin", "/en/flights/madrid-berlin", "/vuelos/barcelona-amsterdam", "/en/flights/barcelona-amsterdam", "/vuelos/madrid-oporto", "/en/flights/madrid-porto", "/vuelos/madrid-buenos-aires", "/en/flights/madrid-buenos-aires", "/vuelos/madrid-ciudad-de-mexico", "/en/flights/madrid-mexico-city", "/vuelos/madrid-bogota", "/en/flights/madrid-bogota", "/vuelos/madrid-lima", "/en/flights/madrid-lima", "/vuelos/madrid-sao-paulo", "/en/flights/madrid-sao-paulo", "/vuelos/madrid-santiago-de-chile", "/en/flights/madrid-santiago", "/vuelos/madrid-cancun", "/en/flights/madrid-cancun", "/vuelos/madrid-rio-de-janeiro", "/en/flights/madrid-rio-de-janeiro"]);

function removedTarget(p) {
  if (!REMOVED.has(p)) return null;
  return p.startsWith('/en/') ? '/en' : '/';
}

function byPath(p) {
  return ROUTES.find((r) => r.path.es === p || r.path.en === p) || null;
}

/** Texto para {PRECIO}: solo un precio real del caché; sin dato, sin número. */
function priceText(price, lang) {
  if (!price) return lang === 'en' ? 'a good fare' : 'un buen precio';
  return `${price.currency === 'EUR' ? '€' : `${price.currency} `}${price.amount}`;
}

function fill(text, price, lang) {
  if (!price) {
    text = String(text).replace(/:\s*\{PRECIO\}/g, '')
      .replace(/una tarifa como \{PRECIO\}/g, 'una buena tarifa')
      .replace(/a fare like \{PRECIO\}/g, 'a good fare')
      .replace(/(el precio|la tarifa) (cae|baja) a \{PRECIO\}/g, '$1 baja')
      .replace(/the (fare|price) drops to \{PRECIO\}/g, 'the $1 drops');
  }
  return String(text).replace(/\{PRECIO\}/g, priceText(price, lang));
}

/** Último precio real visto para la ruta, si está fresco (≤ 7 días). */
async function cachedPrice(db, origin, destination) {
  try {
    const Route = db.col('Route');
    if (!Route) return null;
    const q = Route.findOne({ origin, destination, lastPriceEur: { $gt: 0 }, foundAt: { $ne: null } });
    // Mongoose devuelve una query; la DB en memoria de los tests, una promesa.
    const row = await (q && typeof q.sort === 'function' ? q.sort({ foundAt: -1 }).lean() : q);
    if (!row) return null;
    const amount = Math.round(Number(row.lastPriceEur));
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!isFresh({ foundAt: row.foundAt }, clock.now())) return null;
    return { amount, currency: 'EUR', seen: seenLabel(row.foundAt, clock.now()) };
  } catch {
    return null;
  }
}

function ld(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

function alternates(base, esPath, enPath) {
  return `<link rel="alternate" hreflang="es" href="${esc(base + esPath)}">`
    + `<link rel="alternate" hreflang="en" href="${esc(base + enPath)}">`
    + `<link rel="alternate" hreflang="x-default" href="${esc(base + esPath)}">`;
}

function priceCard(route, price, lang) {
  const tg = `https://t.me/flightalertpro_bot?start=seo_${route.origen_iata}_${route.destino_iata}`;
  const cta = lang === 'en' ? 'Watch this route on Telegram' : 'Vigilar esta ruta en Telegram';
  const body = price
    ? `<p class="price-card__amount">${esc(priceText(price, lang))}</p><p class="price-card__when">${esc(lang === 'en' ? price.seen.replace('visto hace', 'seen').replace(' h', ' h ago') : price.seen)}</p>`
    : `<p class="price-card__amount"><span class="price-card__empty">${lang === 'en' ? 'No recent price for this route' : 'Sin precio reciente para esta ruta'}</span></p>`;
  return `<article class="price-card" data-state="${price ? 'price' : 'empty'}">`
    + `<p class="price-card__when">${esc(route.origen_iata)} → ${esc(route.destino_iata)}</p>${body}`
    + `<p class="price-card__source">${lang === 'en' ? 'Cached Travelpayouts price. The airline confirms the final fare.' : 'Precio en caché de Travelpayouts. El precio final lo confirma la aerolínea.'}</p>`
    + `<a class="btn" href="${tg}">${cta}</a></article>`;
}

function routePage(route, lang, price, nonce = '') {
  const t = route[lang];
  const base = baseUrl();
  const self = route.path[lang];
  const n = nonce ? ` nonce="${esc(nonce)}"` : '';
  const css = `/assets/styles.${landing.hashes.css}.css`;
  const faq = t.faq.map((f) => ({ q: fill(f.q, price, lang), a: fill(f.a, price, lang) }));
  const home = lang === 'en' ? '/en' : '/es';
  const faqLd = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  const crumbLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Flight Alert', item: base + home },
      { '@type': 'ListItem', position: 2, name: t.h1, item: base + self },
    ],
  };
  const desc = fill(t.meta_description, null, lang);
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(t.title)}</title><meta name="description" content="${esc(desc)}">`
    + `<link rel="canonical" href="${esc(base + self)}">${alternates(base, route.path.es, route.path.en)}`
    + `<meta property="og:type" content="article"><meta property="og:title" content="${esc(t.title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(base + self)}">`
    + `<style${n}>${landing.criticalCss()}</style><link rel="stylesheet" href="${css}">`
    + `<script type="application/ld+json"${n}>${ld(faqLd)}</script>`
    + `<script type="application/ld+json"${n}>${ld(crumbLd)}</script>`
    + '</head><body class="page-simple">'
    + `<header class="site-header"><div class="wrap"><a class="wordmark" href="${home}"><img class="bot-logo" src="/public/avatar.webp" alt="" width="36" height="36"><span class="wordmark-label">Flight Alert</span></a></div></header>`
    + `<main id="contenido" class="section"><div class="wrap narrow">`
    + `<nav aria-label="${lang === 'en' ? 'Breadcrumb' : 'Migas'}"><a href="${home}">Flight Alert</a> › <span>${esc(t.h1)}</span></nav>`
    + `<h1>${esc(t.h1)}</h1><p>${esc(fill(t.intro, price, lang))}</p>`
    + priceCard(route, price, lang)
    + `<h2>${lang === 'en' ? 'FAQ' : 'Preguntas frecuentes'}</h2>`
    + faq.map((f) => `<details class="faq-item"><summary class="faq-summary"><span>${esc(f.q)}</span></summary><div class="faq-content"><p>${esc(f.a)}</p></div></details>`).join('')
    + `<p class="fine"><a href="${lang === 'en' ? route.path.es : route.path.en}" hreflang="${lang === 'en' ? 'es' : 'en'}">${lang === 'en' ? 'Español' : 'English'}</a></p>`
    + '</div></main></body></html>';
}

function sitemap() {
  const base = baseUrl();
  const pairs = [['/es', '/en'], ['/pro', '/pro'], ...ROUTES.map((r) => [r.path.es, r.path.en])];
  const urls = [];
  const entry = (loc, es, en) => `<url><loc>${esc(base + loc)}</loc>`
    + `<xhtml:link rel="alternate" hreflang="es" href="${esc(base + es)}"/>`
    + `<xhtml:link rel="alternate" hreflang="en" href="${esc(base + en)}"/>`
    + `<xhtml:link rel="alternate" hreflang="x-default" href="${esc(base + es)}"/></url>`;
  urls.push(entry('/', '/es', '/en'));
  for (const [es, en] of pairs) {
    urls.push(entry(es, es, en));
    if (en !== es) urls.push(entry(en, es, en));
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
    + urls.join('\n') + '\n</urlset>\n';
}

function robots() {
  return `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /app/api\nDisallow: /webhooks/\nDisallow: /pro/checkout\n\nSitemap: ${baseUrl()}/sitemap.xml\n`;
}

/** Cache-Control para HTML público. Nunca en /app/api, /admin, /webhooks ni checkout. */
function htmlCache(req, res, next) {
  const p = req.path;
  const excluded = p.startsWith('/app') || p.startsWith('/admin') || p.startsWith('/webhooks')
    || p.startsWith('/pro/checkout') || p.startsWith('/pro/listo') || p.startsWith('/api');
  if (req.method === 'GET' && !excluded) {
    const send = res.send.bind(res);
    res.send = (body) => {
      const type = String(res.get('Content-Type') || '');
      // Con Set-Cookie no se cachea en público.
      if (res.statusCode === 200 && type.includes('text/html') && !res.get('Set-Cookie')) res.set('Cache-Control', HTML_CACHE);
      return send(body);
    };
  }
  next();
}

const PRO_META = {
  title: 'Flight Alert Pro: alertas de vuelos ilimitadas',
  description: 'Pro de Flight Alert: búsquedas ilimitadas, aviso al momento cuando baja el precio y reporte diario por Telegram. Pagás en pesos, euros o dólares.',
};

function proHead() {
  const base = baseUrl();
  return `<meta name="description" content="${esc(PRO_META.description)}">`
    + `<link rel="canonical" href="${esc(base)}/pro">`
    + `<link rel="alternate" hreflang="es" href="${esc(base)}/pro">`
    + `<link rel="alternate" hreflang="x-default" href="${esc(base)}/pro">`;
}

module.exports = { REMOVED, removedTarget, ROUTES, byPath, routePage, cachedPrice, sitemap, robots, htmlCache, HTML_CACHE, PRO_META, proHead, baseUrl, fill };
