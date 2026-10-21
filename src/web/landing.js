'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ORIGINS, DESTINATIONS } = require('../config/airports');
const { EU } = require('../services/country');
const fx = require('../services/fx');

const BOT = 'flightalertpro_bot';
const BOT_URL = 'https://t.me/flightalertpro_bot';
const PRIVACY = 'Privacidad: el país lo estimamos con una base GeoIP local. La IP no sale del servidor.';

const publicDir = path.join(__dirname, '..', '..', 'public');
const cssSource = fs.readFileSync(path.join(publicDir, 'styles.css'), 'utf8');
const sprite = fs.readFileSync(path.join(publicDir, 'sprite.svg'), 'utf8');
const MARK = '/* end-critical */';

function fileHash(name) {
  const buf = fs.readFileSync(path.join(publicDir, name));
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
}

const hashes = {
  css: fileHash('styles.css'),
  js: fileHash('app.js'),
  png: fileHash('og.png'),
};

const assetFiles = new Map([
  [`styles.${hashes.css}.css`, { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  [`app.${hashes.js}.js`, { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  [`og.${hashes.png}.png`, { file: 'og.png', type: 'image/png' }],
]);

function assetByName(name) {
  const hit = assetFiles.get(name);
  if (!hit) return null;
  return { type: hit.type, body: fs.readFileSync(path.join(publicDir, hit.file)) };
}

function criticalCss() {
  const at = cssSource.indexOf(MARK);
  return at === -1 ? cssSource : cssSource.slice(0, at);
}

function regionFor(geo) {
  const code = String(geo || '').toUpperCase();
  if (code === 'AR') return 'ar';
  if (EU.has(code)) return 'eu';
  return 'other';
}

function arsFromQuote(quote) {
  if (!quote) return null;
  const published = Number(quote.publishedArs);
  if (Number.isFinite(published) && published > 0) return Math.round(published);
  const rate = Number(quote.usedRate);
  if (Number.isFinite(rate) && rate > 0) return fx.arsPrice(rate);
  return null;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

const NAMES = {
  es: {
    EZE: 'Ezeiza, Buenos Aires', COR: 'Córdoba', MDQ: 'Mar del Plata', ROS: 'Rosario', BUE: 'Buenos Aires',
    MAD: 'Madrid', BCN: 'Barcelona', SVQ: 'Sevilla', VLC: 'Valencia', BIO: 'Bilbao',
    FCO: 'Fiumicino, Roma', MXP: 'Malpensa, Milán', NAP: 'Nápoles', VCE: 'Venecia', BGY: 'Bérgamo',
    CDG: 'Charles de Gaulle, París', ORY: 'Orly, París', NCE: 'Niza', LYS: 'Lyon',
    LHR: 'Heathrow, Londres', LGW: 'Gatwick, Londres', STN: 'Stansted, Londres', DUB: 'Dublín',
    AMS: 'Ámsterdam', BRU: 'Bruselas', FRA: 'Fráncfort', MUC: 'Múnich', BER: 'Berlín',
    DUS: 'Düsseldorf', HAM: 'Hamburgo', LIS: 'Lisboa', OPO: 'Oporto', VIE: 'Viena',
    ZRH: 'Zúrich', ATH: 'Atenas', IST: 'Estambul',
  },
  en: {
    EZE: 'Ezeiza, Buenos Aires', COR: 'Cordoba', MDQ: 'Mar del Plata', ROS: 'Rosario', BUE: 'Buenos Aires',
    MAD: 'Madrid', BCN: 'Barcelona', SVQ: 'Seville', VLC: 'Valencia', BIO: 'Bilbao',
    FCO: 'Fiumicino, Rome', MXP: 'Malpensa, Milan', NAP: 'Naples', VCE: 'Venice', BGY: 'Bergamo',
    CDG: 'Charles de Gaulle, Paris', ORY: 'Orly, Paris', NCE: 'Nice', LYS: 'Lyon',
    LHR: 'Heathrow, London', LGW: 'Gatwick, London', STN: 'Stansted, London', DUB: 'Dublin',
    AMS: 'Amsterdam', BRU: 'Brussels', FRA: 'Frankfurt', MUC: 'Munich', BER: 'Berlin',
    DUS: 'Dusseldorf', HAM: 'Hamburg', LIS: 'Lisbon', OPO: 'Porto', VIE: 'Vienna',
    ZRH: 'Zurich', ATH: 'Athens', IST: 'Istanbul',
  },
};

function city(code, lang) {
  return (NAMES[lang] && NAMES[lang][code]) || NAMES.es[code] || code;
}

function abbr(code, lang) {
  return `<abbr title="${esc(city(code, lang))}">${esc(code)}</abbr>`;
}

function icon(id, cls) {
  const extra = cls ? ` class="${cls}"` : '';
  return `<svg${extra} width="16" height="16" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
}

function tg(section) {
  return `${BOT_URL}?start=landing_${section}`;
}

function validSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const price = Math.round(Number(sample.price));
  if (!Number.isFinite(price) || price <= 0) return null;
  const origin = String(sample.origin || '').toUpperCase();
  const destination = String(sample.destination || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) return null;
  const currency = String(sample.currency || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const seenHours = Number(sample.seenHours);
  if (!Number.isFinite(seenHours) || seenHours < 0) return null;
  const hours = Math.round(seenHours);
  const seen = typeof sample.seen === 'string' && sample.seen
    ? sample.seen
    : `visto hace ${hours} h`;
  let departureDate = '';
  if (sample.departureDate && /^\d{4}-\d{2}-\d{2}/.test(String(sample.departureDate))) {
    departureDate = String(sample.departureDate).slice(0, 10);
  }
  return { origin, destination, price, currency, seenHours: hours, seen, departureDate };
}

function fareWords(sample, lang) {
  const n = String(sample.price);
  if (sample.currency === 'EUR') return `${n} euros`;
  if (sample.currency === 'USD') return lang === 'en' ? `${n} US dollars` : `${n} dólares estadounidenses`;
  if (sample.currency === 'ARS') return lang === 'en' ? `${n} Argentine pesos` : `${n} pesos argentinos`;
  return `${n} ${sample.currency}`;
}

function renderSampleCard(sample, lang) {
  const t = copy(lang);
  const row = validSample(sample);
  const state = row ? 'ready' : 'empty';
  const route = row ? `${abbr(row.origin, lang)} → ${abbr(row.destination, lang)}` : '';
  const when = row ? esc(row.departureDate) : '';
  const amount = row
    ? `<span class="js-price" data-value="${row.price}">${row.price}</span> <span class="price-card__ccy">${esc(row.currency)}</span>`
    : esc(t.emptyFare);
  const words = row ? esc(fareWords(row, lang)) : '';
  const seen = row ? esc(lang === 'en' ? `seen ${row.seenHours} h ago` : row.seen) : '';
  const href = row ? `${BOT_URL}?start=${row.origin}-${row.destination}` : tg('hero');
  return `<article class="price-card" id="sample-card" data-state="${state}" data-empty="${esc(t.emptyFare)}">`
    + `<p class="route-chip">${route}</p>`
    + `<p class="price-card__when">${when}</p>`
    + `<p class="price-card__amount">${amount}</p>`
    + `<p class="price-card__words">${words}</p>`
    + `<p class="seen">${icon('i-clock')} <span class="seen__text">${seen}</span></p>`
    + '<svg class="route-draw" viewBox="0 0 320 80" aria-hidden="true" focusable="false"><path pathLength="1" d="M8 64C70 64 90 16 160 16s90 48 152 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    + `<p class="price-card__source">${esc(t.cacheLabel)}</p>`
    + `<a class="btn" href="${href}">${icon('i-tg')}${esc(t.ctaHero)}</a>`
    + '</article>';
}

function copy(lang) {
  const en = lang === 'en';
  const nO = ORIGINS.length;
  const nD = DESTINATIONS.length;
  if (en) {
    return {
      htmlLang: 'en',
      title: 'Cheap flights between Argentina and Europe | Flight Alert',
      description: 'Pick your origin and destination, and the bot tells you when a good fare shows up. Travelpayouts data. 10 searches a month.',
      skip: 'Skip to content',
      pricesLink: 'Pricing',
      openTelegram: 'Open in Telegram',
      themePrefix: 'Theme',
      themeSystem: 'System',
      themeLight: 'Light',
      themeDark: 'Dark',
      langLabel: 'ES',
      h1: 'Cheap flights between Argentina and Europe, right in Telegram.',
      sub: `Pick your origin and destination, and the bot tells you when a good fare shows up. It covers ${nO} origins and ${nD} destinations with Travelpayouts data. Your first search is free.`,
      ctaHero: 'Search free on Telegram',
      seePrices: 'See prices',
      small: 'No sign-up. Just open the bot.',
      quota: '10 searches a month, no card. The daily alert and the 9 PM digest are on a 7-day trial.',
      benefitsTitle: 'In short',
      benefits: [
        'Stop checking fares every day. The bot watches them for you and only messages you when it\'s worth it.',
        'Everything happens in Telegram. There\'s no new app to install and no account to create.',
        'It shows real fares from Travelpayouts searches, each one with a timestamp. These are fares that were found, not promises.',
      ],
      emptyFare: 'No recent fare to show',
      cacheLabel: 'Fare from the Travelpayouts cache',
      proof: 'Powered by Travelpayouts data',
      howTitle: 'How it works',
      steps: [
        ['Open @flightalertpro_bot', 'Choose where you\'re flying from and where you want to go.', 'i-search'],
        ['See the lowest fares', 'The ones available right now for that route.', 'i-pin'],
        ['Go Pro', 'Get a daily alert plus a 9 PM digest.', 'i-bell'],
      ],
      copyStart: 'Copy /start',
      copied: 'Copied',
      routesTitle: `${nO} origins, ${nD} destinations`,
      routesNote: 'Any origin connects with any destination.',
      from: 'From',
      originsLabel: 'Origins',
      pricesTitle: 'Pricing',
      freeTitle: 'Free',
      freeBody: '10 searches a month, no card needed.',
      freeBtn: 'Start free',
      proTitle: 'Pro',
      proItems: [
        'Daily alert',
        '9 PM digest',
        'Searches continue after the monthly cap',
      ],
      trial: 'The 7-day trial covers the alert and the digest, with no card, once. Pro is charged when you pay.',
      proBtn: 'Get Pro',
      stars: 'Or 250 Telegram Stars, in the bot.',
      payNote: 'You pay on the web and the bot sends you the link.',
      cancelNote: 'To stop Pro, write to the bot.',
      previewNote: 'This menu only changes the view. Checkout uses the country the server sees.',
      countryLabel: 'Not your country?',
      optAr: 'Argentina',
      optEu: 'European Union',
      optOther: 'Rest of the world',
      arsMissing: 'No BNA dollar rate is available, so there is no peso price to show.',
      bna: 'at today\'s BNA dollar rate',
      arsWords: (n) => `${n} Argentine pesos, at today's BNA dollar rate.`,
      euFigure: '€4.50',
      euWords: '4.50 euros, VAT included.',
      usdFigure: 'US$5',
      usdWords: '5 US dollars.',
      faqTitle: 'Questions',
      faq: [
        ['Is the fare final?', 'It\'s the fare the search found at that moment. Airlines change prices fast, so always confirm it on the booking page before you pay.'],
        ['Do you sell tickets?', 'No. The bot sends you to the site where you book. Some links are affiliate links: they cost you nothing extra and help keep the bot running.'],
        ['What\'s free?', '10 searches a month, with no card needed. The daily alert and the 9 PM digest can be tried for 7 days, once.'],
        ['Can I cancel Pro?', 'Write to the bot. There is no self-service cancel. /cancel in the chat only stops the step you were on, not the subscription.'],
        ['What happens when the trial ends?', 'After 7 days the alerts and the digest pause, and the bot tells you then. Pro is a 30-day subscription charged when you pay.'],
        ['Which cities?', `It searches from ${nO} origins to ${nD} destinations. The list is on this page and also inside the bot.`],
        ['Will you spam me?', 'No. Pro sends one daily alert and the 9 PM digest, and nothing else.'],
        ['What about my IP?', PRIVACY],
      ],
      finalTitle: 'The next fare drop could land tonight. Be the one who sees it.',
      finalBtn: `Open @${BOT}`,
      contact: 'Contact',
      privacyLink: 'Privacy',
      privacyEn: 'The country is estimated with a local GeoIP database. The IP does not leave the server.',
    };
  }
  return {
    htmlLang: 'es',
    title: 'Vuelos baratos entre Argentina y Europa | Flight Alert',
    description: 'Elegís origen y destino y el bot te avisa cuando aparece un buen precio. Datos de Travelpayouts. 10 búsquedas por mes.',
    skip: 'Saltar al contenido',
    pricesLink: 'Precios',
    openTelegram: 'Abrir en Telegram',
    themePrefix: 'Tema',
    themeSystem: 'Sistema',
    themeLight: 'Claro',
    themeDark: 'Oscuro',
    langLabel: 'EN',
    h1: 'Vuelos baratos entre Argentina y Europa, directo en tu Telegram.',
    sub: `Elegís origen y destino y el bot te avisa cuando aparece un buen precio. Cubre ${nO} orígenes y ${nD} destinos, con datos de Travelpayouts. Tu primera búsqueda es gratis.`,
    ctaHero: 'Buscar gratis en Telegram',
    seePrices: 'Ver precios',
    small: 'Sin registro. Abrís el bot y listo.',
    quota: '10 búsquedas por mes, sin tarjeta. La alerta diaria y el reporte de las 21:00 se prueban 7 días.',
    benefitsTitle: 'En corto',
    benefits: [
      'Dejás de revisar precios todos los días: el bot mira por vos y te escribe solo cuando vale la pena.',
      'Todo pasa en Telegram. No tenés que instalar ninguna app ni crear una cuenta nueva.',
      'Te muestra precios reales de búsquedas de Travelpayouts, con la fecha de cada dato. Son precios encontrados, no promesas.',
    ],
    emptyFare: 'Sin precio reciente para mostrar',
    cacheLabel: 'Precio en caché de Travelpayouts',
    proof: 'Datos de Travelpayouts',
    howTitle: 'Cómo funciona',
    steps: [
      ['Abrís @flightalertpro_bot', 'Elegís de dónde salís y adónde querés ir.', 'i-search'],
      ['Ves los precios más bajos', 'Los que hay ahora para esa ruta.', 'i-pin'],
      ['Si te pasás a Pro', 'Recibís una alerta todos los días y un resumen a las 21:00.', 'i-bell'],
    ],
    copyStart: 'Copiar /start',
    copied: 'Copiado',
    routesTitle: `${nO} orígenes, ${nD} destinos`,
    routesNote: 'Cualquier origen conecta con cualquier destino.',
    from: 'Desde',
    originsLabel: 'Orígenes',
    pricesTitle: 'Precios',
    freeTitle: 'Gratis',
    freeBody: '10 búsquedas por mes, sin tarjeta.',
    freeBtn: 'Empezar gratis',
    proTitle: 'Pro',
    proItems: [
      'Alerta diaria',
      'Resumen a las 21:00',
      'Seguís buscando después del cupo del mes',
    ],
    trial: 'La prueba de 7 días cubre la alerta y el reporte, sin tarjeta y una sola vez. Pro se cobra al confirmar el pago.',
    proBtn: 'Quiero Pro',
    stars: 'O 250 estrellas de Telegram, en el bot.',
    payNote: 'Pagás en la web y te llega el link en el bot.',
    cancelNote: 'Para dejar Pro, escribinos al bot.',
    previewNote: 'Este selector solo cambia la vista. El cobro usa el país que ve el servidor.',
    countryLabel: '¿No es tu país?',
    optAr: 'Argentina',
    optEu: 'Unión Europea',
    optOther: 'Resto del mundo',
    arsMissing: 'Sin cotización del dólar BNA para mostrar el precio en pesos.',
    bna: 'al dólar BNA de hoy',
    arsWords: (n) => `${n} pesos argentinos, al dólar BNA de hoy.`,
    euFigure: '€4,50',
    euWords: '4,50 euros, IVA incluido.',
    usdFigure: 'US$5',
    usdWords: '5 dólares estadounidenses.',
    faqTitle: 'Preguntas frecuentes',
    faq: [
      ['¿El precio es final?', 'Es el precio que encontró la búsqueda en ese momento. Las aerolíneas lo cambian rápido, así que confirmalo siempre en la página de reserva antes de pagar.'],
      ['¿Ustedes venden los pasajes?', 'No. El bot te lleva al sitio donde se compra. Algunos links son de afiliado: no te cuestan nada extra y nos ayudan a mantener el bot.'],
      ['¿Qué incluye lo gratis?', '10 búsquedas por mes, sin tarjeta. La alerta diaria y el reporte de las 21:00 se prueban 7 días, una sola vez.'],
      ['¿Puedo cancelar Pro?', 'Escribinos al bot. No hay baja self-service: /cancel en el chat solo corta lo que estabas haciendo, no la suscripción.'],
      ['¿Qué pasa cuando termina la prueba?', 'A los 7 días se pausan las alertas y el reporte, y el bot te avisa en ese momento. Pro es una suscripción de 30 días que se cobra al pagar.'],
      ['¿Desde qué ciudades busca?', `Desde ${nO} orígenes y hacia ${nD} destinos. La lista está en esta página y también adentro del bot.`],
      ['¿Me van a llenar de mensajes?', 'No. Pro te manda una alerta diaria y el resumen de las 21:00, nada más.'],
      ['¿Qué hacen con mi IP?', PRIVACY],
    ],
    finalTitle: 'El próximo precio bajo puede aparecer esta noche. Que te encuentre a vos.',
    finalBtn: `Abrir @${BOT}`,
    contact: 'Contacto',
    privacyLink: 'Privacidad',
    privacyEn: '',
  };
}

function formatArs(amount, lang) {
  return new Intl.NumberFormat(lang === 'en' ? 'en-US' : 'es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(amount);
}

function priceBlocks(lang, region, ars) {
  const t = copy(lang);
  const arsInner = Number.isInteger(ars) && ars > 0
    ? `<p class="plan__figure">${esc(formatArs(ars, lang))}</p><p class="plan__words">${esc(t.arsWords(ars))}</p><p class="fine">${esc(t.bna)}</p>`
    : `<p class="plan__words">${esc(t.arsMissing)}</p>`;
  const blocks = [
    ['ar', arsInner],
    ['eu', `<p class="plan__figure">${esc(t.euFigure)}</p><p class="plan__words">${esc(t.euWords)}</p>`],
    ['other', `<p class="plan__figure">${esc(t.usdFigure)}</p><p class="plan__words">${esc(t.usdWords)}</p>`],
  ];
  return blocks.map(([id, inner]) => {
    const hidden = id === region ? '' : ' hidden';
    const current = id === region ? ' aria-current="true"' : '';
    return `<div class="plan__price" data-price-region="${id}"${hidden}${current}>${inner}</div>`;
  }).join('');
}

function panels(lang) {
  const t = copy(lang);
  return ORIGINS.map((origin, index) => {
    const active = index === 0 ? ' is-active' : '';
    const items = DESTINATIONS.map((code) => `<li>${abbr(code, lang)}</li>`).join('');
    return `<div class="tab-panel${active}" id="panel-${origin}" role="tabpanel" aria-labelledby="tab-${origin}">`
      + `<h3>${esc(t.from)} ${abbr(origin, lang)}</h3>`
      + `<ul class="dest-grid">${items}</ul>`
      + '</div>';
  }).join('');
}

function tabs(lang) {
  const t = copy(lang);
  const buttons = ORIGINS.map((origin, index) => {
    const selected = index === 0;
    return `<button type="button" role="tab" id="tab-${origin}" aria-controls="panel-${origin}" aria-selected="${selected ? 'true' : 'false'}" tabindex="${selected ? '0' : '-1'}">${abbr(origin, lang)}</button>`;
  }).join('');
  return `<div class="tabs" role="tablist" aria-label="${esc(t.originsLabel)}" aria-orientation="horizontal">${buttons}</div>`;
}

function jsonLd(lang, ars) {
  const t = copy(lang);
  const offers = [
    { '@type': 'Offer', price: '4.50', priceCurrency: 'EUR', description: lang === 'en' ? 'VAT included' : 'IVA incluido' },
    { '@type': 'Offer', price: '5', priceCurrency: 'USD' },
    { '@type': 'Offer', price: '250', priceCurrency: 'XTR', description: 'Telegram Stars' },
  ];
  if (Number.isInteger(ars) && ars > 0) {
    offers.push({ '@type': 'Offer', price: String(ars), priceCurrency: 'ARS', description: 'BNA' });
  }
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Flight Alert Pro',
    description: t.description,
    brand: { '@type': 'Brand', name: 'Ranuk IT' },
    offers,
  }).replace(/</g, '\\u003c');
}

function abs(base, urlPath) {
  const root = String(base || '').replace(/\/$/, '');
  return root ? root + urlPath : urlPath;
}

function renderLanding(ctx = {}) {
  const lang = ctx.lang === 'en' ? 'en' : 'es';
  const t = copy(lang);
  const region = ctx.region === 'ar' || ctx.region === 'eu' || ctx.region === 'other' ? ctx.region : 'other';
  const ars = Number.isInteger(ctx.ars) && ctx.ars > 0 ? ctx.ars : null;
  const nonce = ctx.nonce ? ` nonce="${esc(ctx.nonce)}"` : '';
  const cssHref = `/assets/styles.${hashes.css}.css`;
  const jsHref = `/assets/app.${hashes.js}.js`;
  const image = abs(ctx.base, `/assets/og.${hashes.png}.png`);
  const canonical = abs(ctx.base, lang === 'en' ? '/en' : '/es');
  const homeEs = abs(ctx.base, '/es');
  const homeEn = abs(ctx.base, '/en');
  const switchHref = lang === 'en' ? '/es' : '/en';
  const wordmark = lang === 'en' ? '/en' : '/es';
  const options = [['ar', t.optAr], ['eu', t.optEu], ['other', t.optOther]]
    .map(([id, label]) => `<option value="${id}"${id === region ? ' selected' : ''}>${esc(label)}</option>`)
    .join('');
  const steps = t.steps.map((step, index) => {
    const copyBtn = index === 0
      ? `<button type="button" class="btn btn--ghost" data-copy="/start" data-copied="${esc(t.copied)}">${esc(t.copyStart)}</button><p id="copy-status" aria-live="polite"></p>`
      : '';
    return `<li>${icon(step[2], 'step-icon')}<h3>${esc(step[0])}</h3><p>${esc(step[1])}</p>${copyBtn}</li>`;
  }).join('');
  const benefits = t.benefits.map((line) => `<li>${esc(line)}</li>`).join('');
  const faq = t.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('');
  const privacyExtra = t.privacyEn ? `<p>${esc(t.privacyEn)}</p>` : '';
  const arcs = '<svg class="arcs" viewBox="0 0 360 120" aria-hidden="true" focusable="false">'
    + '<path d="M16 96C80 96 100 28 180 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M16 96C120 100 160 40 250 36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M16 96C140 110 220 48 330 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
    + '</svg>';

  return `<!doctype html><html lang="${t.htmlLang}"><head><meta charset="utf-8">`
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${esc(t.title)}</title>`
    + `<meta name="description" content="${esc(t.description)}">`
    + `<link rel="canonical" href="${esc(canonical)}">`
    + `<link rel="alternate" hreflang="es" href="${esc(homeEs)}">`
    + `<link rel="alternate" hreflang="en" href="${esc(homeEn)}">`
    + `<link rel="alternate" hreflang="x-default" href="${esc(homeEs)}">`
    + `<meta property="og:type" content="website"><meta property="og:title" content="${esc(t.title)}">`
    + `<meta property="og:description" content="${esc(t.description)}">`
    + `<meta property="og:url" content="${esc(canonical)}">`
    + `<meta property="og:image" content="${esc(image)}">`
    + '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
    + '<meta name="twitter:card" content="summary_large_image">'
    + `<meta name="twitter:title" content="${esc(t.title)}">`
    + `<meta name="twitter:description" content="${esc(t.description)}">`
    + `<meta name="twitter:image" content="${esc(image)}">`
    + `<script${nonce}>(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);}catch(e){}document.documentElement.classList.add("js");})();</script>`
    + `<style${nonce}>${criticalCss()}</style>`
    + `<link rel="preload" href="${cssHref}" as="style">`
    + `<link rel="stylesheet" href="${cssHref}">`
    + `<script type="application/ld+json"${nonce}>${jsonLd(lang, ars)}</script>`
    + `${ctx.drive || ''}</head><body>`
    + `<a class="skip" href="#contenido">${esc(t.skip)}</a>`
    + sprite
    + '<div id="top-sentinel"></div>'
    + '<header class="site-header"><div class="wrap">'
    + `<a class="wordmark" href="${wordmark}">Flight Alert</a>`
    + `<nav class="nav" aria-label="${lang === 'en' ? 'Primary' : 'Principal'}">`
    + `<a href="#precios">${esc(t.pricesLink)}</a>`
    + `<a class="btn btn--ghost" href="${tg('header')}">${esc(t.openTelegram)}</a>`
    + `<button type="button" id="theme-toggle" data-mode="system" data-prefix="${esc(t.themePrefix)}" data-label-system="${esc(t.themeSystem)}" data-label-light="${esc(t.themeLight)}" data-label-dark="${esc(t.themeDark)}" aria-label="${esc(t.themePrefix)}: ${esc(t.themeSystem)}">${esc(t.themeSystem)}</button>`
    + `<a href="${switchHref}" hreflang="${lang === 'en' ? 'es' : 'en'}">${esc(t.langLabel)}</a>`
    + '</nav></div></header>'
    + '<main id="contenido" tabindex="-1">'
    + '<section class="hero section" aria-labelledby="titulo">'
    + '<div class="wrap hero-grid"><div>'
    + `<h1 id="titulo">${esc(t.h1)}</h1>`
    + `<p class="lede">${esc(t.sub)}</p>`
    + `<div class="actions"><a class="btn" href="${tg('hero')}">${icon('i-tg')}${esc(t.ctaHero)}</a>`
    + `<a class="btn btn--ghost" href="#precios">${esc(t.seePrices)}</a></div>`
    + `<p class="fine">${esc(t.small)}</p>`
    + `<p class="fine">${esc(t.quota)}</p>`
    + `<h2>${esc(t.benefitsTitle)}</h2><ul class="benefits">${benefits}</ul>`
    + '</div><div>'
    + renderSampleCard(ctx.sample, lang)
    + `<p class="proof">${esc(t.proof)}</p>`
    + '</div></div></section>'
    + '<section class="section reveal" id="como" aria-labelledby="como-titulo"><div class="wrap">'
    + `<h2 id="como-titulo">${esc(t.howTitle)}</h2><ol class="steps">${steps}</ol>`
    + '</div></section>'
    + '<section class="section reveal" id="rutas" aria-labelledby="rutas-titulo"><div class="wrap">'
    + `<h2 id="rutas-titulo">${esc(t.routesTitle)}</h2>`
    + `<p class="fine">${esc(t.routesNote)}</p>`
    + tabs(lang)
    + panels(lang)
    + arcs
    + '</div></section>'
    + '<section class="section reveal" id="precios" aria-labelledby="precios-titulo"><div class="wrap">'
    + `<h2 id="precios-titulo">${esc(t.pricesTitle)}</h2>`
    + '<div class="plans">'
    + `<article class="plan"><h3>${esc(t.freeTitle)}</h3><p>${esc(t.freeBody)}</p>`
    + `<a class="btn btn--ghost" href="${tg('precios')}">${esc(t.freeBtn)}</a></article>`
    + '<article class="plan plan--pro is-highlight">'
    + `<h3>${esc(t.proTitle)}</h3>`
    + priceBlocks(lang, region, ars)
    + `<ul>${t.proItems.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    + `<p>${esc(t.trial)}</p>`
    + `<p>${esc(t.stars)}</p>`
    + `<a class="btn" href="/pro">${esc(t.proBtn)}</a>`
    + '</article></div>'
    + `<label class="country-pick" for="country-preview">${esc(t.countryLabel)}`
    + `<select id="country-preview" data-detected="${region}">${options}</select></label>`
    + `<p class="fine">${esc(t.previewNote)}</p>`
    + `<p>${esc(t.payNote)}</p>`
    + `<p>${esc(t.cancelNote)}</p>`
    + `<p class="privacy" id="privacidad">${icon('i-lock')} ${PRIVACY}</p>`
    + privacyExtra
    + '</div></section>'
    + '<section class="section reveal" id="faq" aria-labelledby="faq-titulo"><div class="wrap">'
    + `<h2 id="faq-titulo">${esc(t.faqTitle)}</h2><div class="faq">${faq}</div>`
    + '</div></section>'
    + '<section class="section reveal" id="cierre" aria-labelledby="cierre-titulo"><div class="wrap">'
    + `<div class="cta-final"><h2 id="cierre-titulo">${esc(t.finalTitle)}</h2>`
    + `<a class="btn" href="${tg('cta')}">${icon('i-tg')}${esc(t.finalBtn)}</a></div>`
    + '</div></section>'
    + '</main>'
    + '<footer class="site-footer"><div class="wrap">'
    + `<nav aria-label="${lang === 'en' ? 'Footer' : 'Pie'}">`
    + `<a href="${tg('footer')}">${esc(t.contact)}</a>`
    + `<a href="#privacidad">${esc(t.privacyLink)}</a>`
    + '</nav><p>© Ranuk IT</p></div></footer>'
    + `<script src="${jsHref}" defer></script>`
    + '</body></html>';
}

module.exports = {
  renderLanding,
  renderSampleCard,
  regionFor,
  arsFromQuote,
  assetByName,
  criticalCss,
  hashes,
  PRIVACY,
  BOT,
};
