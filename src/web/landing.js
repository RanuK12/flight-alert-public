'use strict';

const pricing = require('../config/pricing');

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

const imageFiles = ['avatar.webp', 'madrid.webp', 'barcelona.webp', 'roma.webp', 'paris.webp', 'lisboa.webp'];
const assetFiles = new Map([
  [`styles.${hashes.css}.css`, { file: 'styles.css', type: 'text/css; charset=utf-8' }],
  [`app.${hashes.js}.js`, { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  [`og.${hashes.png}.png`, { file: 'og.png', type: 'image/png' }],
]);

imageFiles.forEach((file) => {
  if (fs.existsSync(path.join(publicDir, file))) {
    assetFiles.set(file, { file, type: 'image/webp' });
  }
});

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
  const route = row
    ? `${abbr(row.origin, lang)} → ${abbr(row.destination, lang)}`
    : `${abbr('EZE', lang)} → ${abbr('MAD', lang)}`;
  const when = row ? esc(row.departureDate) : (lang === 'en' ? 'Upcoming monitored fares' : 'Próximas tarifas monitoreadas');
  const amount = row
    ? `<span class="js-price" data-value="${row.price}">${row.price}</span> <span class="price-card__ccy">${esc(row.currency)}</span>`
    : `<span class="price-card__empty">${lang === 'en' ? 'No recent price for this route' : 'Sin precio reciente para esta ruta'}</span>`;
  const words = row ? esc(fareWords(row, lang)) : '';
  const seen = row
    ? esc(lang === 'en' ? `seen ${row.seenHours} h ago` : row.seen)
    : '';
  const href = row ? `${BOT_URL}?start=${row.origin}-${row.destination}` : tg('hero');
  const popularPreview = !row
    ? `<div class="popular-routes-preview"><span class="route-pill is-active">${abbr('EZE', lang)} → ${abbr('MAD', lang)}</span><span class="route-pill">${abbr('EZE', lang)} → ${abbr('BCN', lang)}</span><span class="route-pill">${abbr('COR', lang)} → ${abbr('FCO', lang)}</span></div>`
    : '';

  return `<article class="price-card" id="sample-card" data-state="${state}">`
    + (row ? `<div class="price-card__header"><p class="route-chip">${route}</p></div>` : '')
    + popularPreview
    + `<p class="price-card__when">${when}</p>`
    + '<div class="price-card__price-row">'
    + `<p class="price-card__amount">${amount}</p>`
    + '</div>'
    + (words ? `<p class="price-card__words">${words}</p>` : '')
    + (seen ? `<p class="seen">${icon('i-clock')} <span class="seen__text">${seen}</span></p>` : '')
    + '<svg class="route-draw" viewBox="0 0 320 80" aria-hidden="true" focusable="false"><path pathLength="1" d="M8 64C70 64 90 16 160 16s90 48 152 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    + `<p class="price-card__source">${esc(t.cacheLabel)}</p>`
    + `<a class="btn" href="${href}">${icon('i-tg')}${esc(t.ctaHero)}</a>`
    + '</article>';
}

const POPULAR_DESTINATIONS = [
  { code: 'MAD', file: 'madrid.webp', es: { city: 'Madrid', country: 'España', note: 'Vuelos directos y 1 escala' }, en: { city: 'Madrid', country: 'Spain', note: 'Direct & 1-stop flights' } },
  { code: 'BCN', file: 'barcelona.webp', es: { city: 'Barcelona', country: 'España', note: 'Vuelos directos y 1 escala' }, en: { city: 'Barcelona', country: 'Spain', note: 'Direct & 1-stop flights' } },
  { code: 'FCO', file: 'roma.webp', es: { city: 'Roma', country: 'Italia', note: 'Vuelos directos y 1 escala' }, en: { city: 'Rome', country: 'Italy', note: 'Direct & 1-stop flights' } },
  { code: 'CDG', file: 'paris.webp', es: { city: 'París', country: 'Francia', note: 'Conexiones diarias' }, en: { city: 'Paris', country: 'France', note: 'Daily connections' } },
  { code: 'LIS', file: 'lisboa.webp', es: { city: 'Lisboa', country: 'Portugal', note: 'Excelente puerta de entrada' }, en: { city: 'Lisbon', country: 'Portugal', note: 'Top European gateway' } },
];

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
      h1: 'Cheap flights to Europe, without spending all day searching',
      eyebrow: 'Argentina ⇄ Europe',
      micro: '1 free search, then 10 a month. No card.',
      priceFoot: 'Cached prices. The final price is confirmed by the airline or agency. Some links are affiliate links.',
      sub: 'We message you on Telegram when the price of your route drops. Prices checked every 2–3 h.',
      ctaHero: 'Open in Telegram',
      seePrices: 'See prices',
      small: 'No sign-up. Just open the bot.',
      quota: '10 searches a month, no card. The daily alert and the 9 PM digest are on a 7-day trial.',
      benefitsTitle: 'In short',
      benefits: [
        'Stop checking fares every day. The bot watches them for you and only messages you when it\'s worth it.',
        'Everything happens in Telegram. There\'s no new app to install and no account to create.',
        'It shows real fares from Travelpayouts searches, each one with a timestamp. These are fares that were found, not promises.',
      ],
      emptyFare: 'We check prices every few hours',
      cacheLabel: 'Fare from the Travelpayouts cache',
      proof: 'Powered by Travelpayouts data',
      howTitle: 'How it works',
      steps: [
        ['Choose your route', 'Pick your departure airport in Argentina and your European destination.', 'i-search'],
        ['Set your target price', 'Tell the bot your maximum budget. It writes when a fare fits.', 'i-sliders'],
        ['Alerts when prices drop', 'When a fare you follow drops, you get a Telegram message with the booking link.', 'i-zap'],
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
      proBadge: 'Recommended',
      proItems: [
        'Unlimited searches (fair use)',
        'Alert when the price drops',
        'Daily digest at 9 PM Argentina time',
      ],
      trial: 'The 7-day trial covers the alert and the digest, with no card, once. Pro is charged when you pay.',
      proBtn: 'Get Pro',
      stars: 'Or 250 Telegram Stars, in the bot.',
      starsPeriod: 'Or 250 Telegram Stars for 30 days, in the bot.',
      payNote: 'You pay on the web and the bot sends you the link.',
      cancelNote: 'To stop Pro, write to the bot.',
      previewNote: 'This menu only changes the view. Checkout uses the country the server sees.',
      countryLabel: 'Not your country?',
      optAr: 'Argentina',
      optEu: 'European Union',
      optOther: 'Rest of the world',
      arsMissing: 'No official dollar rate is available, so there is no peso price to show.',
      bna: 'at today\'s official dollar rate',
      arsWords: (n) => `${n} Argentine pesos, at today's official dollar rate.`,
      euFigure: `€${pricing.figure(pricing.PRO_EUR_CENTS, 'en')}`,
      euWords: `${pricing.figure(pricing.PRO_EUR_CENTS, 'en')} euros, VAT included.`,
      usdFigure: 'US$5',
      usdWords: '5 US dollars.',
      destinationsTitle: 'Popular destinations in Europe',
      destinationsSub: 'Top monitored routes from Argentina with daily price checks.',
      trustOrigins: '5 origins',
      trustOriginsList: 'EZE · COR · MDQ · ROS · BUE',
      trustDestinations: '31 destinations',
      trustDestinationsList: 'Madrid, Rome, Paris, London & more',
      trustData: 'Travelpayouts',
      trustDataDesc: 'Real cached fares',
      trustPayments: 'Secure payments',
      trustPaymentsDesc: 'Stripe · Mercado Pago · Stars',
      faqTitle: 'Questions',
      faq: [
        ['Is the fare final?', 'It\'s the fare the search found at that moment. Airlines change prices fast, so always confirm it on the booking page before you pay.'],
        ['Do you sell tickets?', 'No. The bot sends you to the site where you book. Some links are affiliate links: they cost you nothing extra and help keep the bot running.'],
        ['What\'s free?', '10 searches a month, with no card needed. The daily alert and the 9 PM digest can be tried for 7 days, once.'],
        ['Can I cancel Pro?', 'Write to the bot. There is no self-service cancel. /cancel in the chat only stops the step you were on, not the subscription.'],
        ['What happens when the trial ends?', 'After 7 days the alerts and the digest pause, and the bot tells you then. Pro is a 30-day subscription charged when you pay.'],
        ['Which cities?', `It searches from ${nO} origins to ${nD} destinations. The list is on this page and also inside the bot.`],
        ['Will you spam me?', 'No. Pro messages you when a fare you follow drops, plus one digest at 9 PM Argentina time.'],
        ['What about my IP?', PRIVACY],
      ],
      finalTitle: 'The next fare drop could land tonight. Be the one who sees it.',
      finalBtn: `Open @${BOT}`,
      contact: 'Contact',
      privacyLink: 'Privacy',
      privacyEn: 'The country is estimated with a local GeoIP database. The IP does not leave the server.',
      affiliateNote: 'Some links are affiliate links: they cost you nothing extra and help keep the service running.',
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
    h1: 'Vuelos baratos a Europa, sin pasarte el día buscando',
    eyebrow: 'Argentina ⇄ Europa',
    micro: '1 búsqueda gratis y después 10 por mes. Sin tarjeta.',
    priceFoot: 'Precios en caché. El precio final lo confirma la aerolínea o la agencia. Algunos enlaces son de afiliado.',
    sub: 'Te avisamos por Telegram cuando baja el precio de tu ruta. Precios revisados cada 2–3 h.',
    ctaHero: 'Abrir en Telegram',
    seePrices: 'Ver precios',
    small: 'Sin registro. Abrís el bot y listo.',
    quota: '10 búsquedas por mes, sin tarjeta. La alerta diaria y el reporte de las 21:00 se prueban 7 días.',
    benefitsTitle: 'En corto',
    benefits: [
      'Dejás de revisar precios todos los días: el bot mira por vos y te escribe solo cuando vale la pena.',
      'Todo pasa en Telegram. No tenés que instalar ninguna app ni crear una cuenta nueva.',
      'Te muestra precios reales de búsquedas de Travelpayouts, con la fecha de cada dato. Son precios encontrados, no promesas.',
    ],
    emptyFare: 'Revisamos precios cada pocas horas',
    cacheLabel: 'Precio en caché de Travelpayouts',
    proof: 'Datos de Travelpayouts',
    howTitle: 'Cómo funciona',
    steps: [
      ['Elegís la ruta', 'Elegís de dónde salís en Argentina y adónde querés ir en Europa.', 'i-search'],
      ['Fijás tu precio máximo', 'Le indicás al bot cuánto estás dispuesto a pagar. Te escribe cuando una tarifa entra.', 'i-sliders'],
      ['Te avisa cuando baja', 'Cuando baja una tarifa que seguís, te llega un mensaje a Telegram con el link para reservar.', 'i-zap'],
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
    proBadge: 'Recomendado',
    proItems: [
      'Búsquedas ilimitadas (uso justo)',
      'Aviso cuando baja el precio',
      'Reporte diario a las 21 h (hora Argentina)',
    ],
    trial: 'La prueba de 7 días cubre la alerta y el reporte, sin tarjeta y una sola vez. Pro se cobra al confirmar el pago.',
    proBtn: 'Quiero Pro',
    stars: 'O 250 estrellas de Telegram, en el bot.',
    starsPeriod: 'O 250 estrellas de Telegram por 30 días, en el bot.',
    payNote: 'Pagás en la web y te llega el link en el bot.',
    cancelNote: 'Para dejar Pro, escribinos al bot.',
    previewNote: 'Este selector solo cambia la vista. El cobro usa el país que ve el servidor.',
    countryLabel: '¿No es tu país?',
    optAr: 'Argentina',
    optEu: 'Unión Europea',
    optOther: 'Resto del mundo',
    arsMissing: 'Sin cotización del dólar oficial para mostrar el precio en pesos.',
    bna: 'al dólar oficial de hoy',
    arsWords: (n) => `${n} pesos argentinos, al dólar oficial de hoy.`,
    euFigure: `€${pricing.figure(pricing.PRO_EUR_CENTS, 'es')}`,
    euWords: `${pricing.figure(pricing.PRO_EUR_CENTS, 'es')} euros, IVA incluido.`,
    usdFigure: 'US$5',
    usdWords: '5 dólares estadounidenses.',
    destinationsTitle: 'Destinos populares en Europa',
    destinationsSub: 'Las rutas más buscadas desde Argentina, monitoreadas todos los días.',
    trustOrigins: '5 orígenes',
    trustOriginsList: 'EZE · COR · MDQ · ROS · BUE',
    trustDestinations: '31 destinos',
    trustDestinationsList: 'Madrid, Barcelona, Roma, París y más',
    trustData: 'Datos de Travelpayouts',
    trustDataDesc: 'Precios reales en caché',
    trustPayments: 'Pagos seguros',
    trustPaymentsDesc: 'Stripe · Mercado Pago · Stars',
    faqTitle: 'Preguntas frecuentes',
    faq: [
      ['¿El precio es final?', 'Es el precio que encontró la búsqueda en ese momento. Las aerolíneas lo cambian rápido, así que confirmalo siempre en la página de reserva antes de pagar.'],
      ['¿Ustedes venden los pasajes?', 'No. El bot te lleva al sitio donde se compra. Algunos links son de afiliado: no te cuestan nada extra y nos ayudan a mantener el bot.'],
      ['¿Qué incluye lo gratis?', '10 búsquedas por mes, sin tarjeta. La alerta diaria y el reporte de las 21:00 se prueban 7 días, una sola vez.'],
      ['¿Puedo cancelar Pro?', 'Escribinos al bot. No hay baja self-service: /cancel en el chat solo corta lo que estabas haciendo, no la suscripción.'],
      ['¿Qué pasa cuando termina la prueba?', 'A los 7 días se pausan las alertas y el reporte, y el bot te avisa en ese momento. Pro es una suscripción de 30 días que se cobra al pagar.'],
      ['¿Desde qué ciudades busca?', `Desde ${nO} orígenes y hacia ${nD} destinos. La lista está en esta página y también adentro del bot.`],
      ['¿Me van a llenar de mensajes?', 'No. Pro te avisa cuando baja una tarifa que seguís, y te manda un solo resumen a las 21:00.'],
      ['¿Qué hacen con mi IP?', PRIVACY],
    ],
    finalTitle: 'El próximo precio bajo puede aparecer esta noche. Que te encuentre a vos.',
    finalBtn: `Abrir @${BOT}`,
    contact: 'Contacto',
    privacyLink: 'Privacidad',
    privacyEn: '',
    affiliateNote: 'Algunos links son de afiliado: no te cuestan nada extra y nos ayudan a mantener el servicio.',
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
    ['stars', `<p class="plan__figure">250 ⭐</p><p class="plan__words">${lang === 'en' ? '250 Telegram Stars for 30 days, paid inside the bot.' : '250 estrellas de Telegram por 30 días, se paga en el bot.'}</p>`],
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
    { '@type': 'Offer', price: pricing.figure(pricing.PRO_EUR_CENTS, 'en'), priceCurrency: 'EUR', description: lang === 'en' ? 'VAT included' : 'IVA incluido' },
    { '@type': 'Offer', price: '5', priceCurrency: 'USD' },
    { '@type': 'Offer', price: '250', priceCurrency: 'XTR', description: 'Telegram Stars' },
  ];
  if (Number.isInteger(ars) && ars > 0) {
    offers.push({ '@type': 'Offer', price: String(ars), priceCurrency: 'ARS', description: 'Dólar oficial' });
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


const REGIONS = [
  ['es', 'España', 'Spain', ['MAD', 'BCN', 'SVQ', 'VLC', 'BIO']],
  ['it', 'Italia', 'Italy', ['FCO', 'MXP', 'NAP', 'VCE', 'BGY']],
  ['fr', 'Francia', 'France', ['CDG', 'ORY', 'NCE', 'LYS']],
  ['uk', 'Reino Unido e Irlanda', 'UK & Ireland', ['LHR', 'LGW', 'STN', 'DUB']],
  ['de', 'Alemania', 'Germany', ['FRA', 'MUC', 'BER', 'DUS', 'HAM']],
  ['pt', 'Portugal', 'Portugal', ['LIS', 'OPO']],
  ['other', 'Benelux y más', 'Benelux & more', ['AMS', 'BRU', 'VIE', 'ZRH', 'ATH', 'IST']],
];
const COUNTRY = {
  es: { es: 'España', it: 'Italia', fr: 'Francia', uk: 'Reino Unido', de: 'Alemania', pt: 'Portugal' },
  en: { es: 'Spain', it: 'Italy', fr: 'France', uk: 'United Kingdom', de: 'Germany', pt: 'Portugal' },
};
const OTHER_COUNTRY = {
  es: { DUB: 'Irlanda', AMS: 'Países Bajos', BRU: 'Bélgica', VIE: 'Austria', ZRH: 'Suiza', ATH: 'Grecia', IST: 'Turquía' },
  en: { DUB: 'Ireland', AMS: 'Netherlands', BRU: 'Belgium', VIE: 'Austria', ZRH: 'Switzerland', ATH: 'Greece', IST: 'Türkiye' },
};

/** P1.3: los 31 destinos con filtro por región (radios). Sin precio inventado: solo ciudad, país e IATA. */
function allDestinations(lang) {
  const en = lang === 'en';
  const chips = [['all', en ? 'All' : 'Todos']].concat(REGIONS.map(([id, es, eng]) => [id, en ? eng : es]))
    .map(([id, label], i) => `<label class="chip"><input type="radio" name="dest-region" value="${id}"${i === 0 ? ' checked' : ''}><span>${esc(label)}</span></label>`).join('');
  let n = 0;
  const cards = REGIONS.flatMap(([id, , , codes]) => codes.map((code) => {
    n += 1;
    const country = OTHER_COUNTRY[lang][code] || COUNTRY[lang][id] || '';
    const extra = n > 8 ? ' dest-more' : '';
    return `<li class="dest-mini${extra}" data-region="${id}"><a href="${BOT_URL}?start=EZE-${code}">`
      + `<span class="dest-mini__city">${esc(city(code, lang))}</span>`
      + `<span class="dest-mini__country">${esc(country)}</span>`
      + `<span class="dest-mini__iata">${code}</span><span class="dest-mini__arrow" aria-hidden="true">→</span></a></li>`;
  })).join('');
  return '<div class="destinations">'
    + `<fieldset class="chips"><legend class="sr-only">${en ? 'Filter by region' : 'Filtrar por región'}</legend><div role="radiogroup" class="chip-row" aria-label="${en ? 'Region' : 'Región'}">${chips}</div></fieldset>`
    + `<ul class="dest-all" id="dest-all" data-collapsed="true">${cards}</ul>`
    + `<button type="button" class="btn btn--ghost dest-toggle" aria-expanded="false" aria-controls="dest-all" data-more="${en ? `See all ${n} destinations` : `Ver los ${n} destinos`}" data-less="${en ? 'Show fewer' : 'Ver menos'}">${en ? `See all ${n} destinations` : `Ver los ${n} destinos`}</button>`
    + '</div>';
}

function destinationCards(lang) {
  return POPULAR_DESTINATIONS.map((d) => {
    const info = lang === 'en' ? d.en : d.es;
    const btnLabel = lang === 'en' ? 'Search in Telegram' : 'Buscar en Telegram';
    return `<article class="dest-card">`
      + `<div class="dest-card__media">`
      + `<img src="/public/${d.file}" alt="${esc(info.city)}" width="420" height="280" loading="lazy" decoding="async">`
      + `<span class="dest-card__chip">${abbr(d.code, lang)}</span>`
      + `</div>`
      + `<div class="dest-card__body">`
      + `<div class="dest-card__head">`
      + `<h3>${esc(info.city)}</h3>`
      + `<span class="dest-card__country">${esc(info.country)}</span>`
      + `</div>`
      + `<p class="dest-card__note">${esc(info.note)}</p>`
      + `<a class="dest-card__btn" href="${BOT_URL}?start=EZE-${d.code}">${esc(btnLabel)} →</a>`
      + `</div>`
      + `</article>`;
  }).join('');
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
  const ccy = [['ar', 'ARS'], ['eu', 'EUR'], ['other', 'USD'], ['stars', 'Stars']];
  const options = ccy.map(([id, label]) => `<label class="ccy-opt"><input type="radio" name="ccy" value="${id}"${id === region ? ' checked' : ''}><span>${label}</span></label>`).join('');
  const steps = t.steps.map((step, index) => {
    const copyBtn = index === 0
      ? `<button type="button" class="btn btn--ghost" data-copy="/start" data-copied="${esc(t.copied)}">${esc(t.copyStart)}</button><p id="copy-status" aria-live="polite"></p>`
      : '';
    return `<li>${icon(step[2], 'step-icon')}<h3>${esc(step[0])}</h3><p>${esc(step[1])}</p>${copyBtn}</li>`;
  }).join('');
  const benefits = t.benefits.map((line) => `<li>${esc(line)}</li>`).join('');
  const faq = t.faq.map(([q, a]) => (
    `<details class="faq-item">`
    + `<summary class="faq-summary"><span>${esc(q)}</span>${icon('i-chevron', 'faq-chevron')}</summary>`
    + `<div class="faq-content"><p>${esc(a)}</p></div>`
    + `</details>`
  )).join('');
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
    + '<link rel="preload" href="/public/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>'
    + `<link rel="preload" href="${cssHref}" as="style">`
    + `<link rel="stylesheet" href="${cssHref}">`
    + `<script type="application/ld+json"${nonce}>${jsonLd(lang, ars)}</script>`
    + `${ctx.drive || ''}</head><body>`
    + `<a class="skip" href="#contenido">${esc(t.skip)}</a>`
    + sprite
    + '<div id="top-sentinel"></div>'
    + '<header class="site-header"><div class="wrap">'
    + `<a class="wordmark" href="${wordmark}"><img class="bot-logo" src="/public/avatar.webp" alt="" width="36" height="36"><span class="wordmark-label">Flight Alert</span></a>`
    + `<nav class="nav" aria-label="${lang === 'en' ? 'Primary' : 'Principal'}">`
    + `<a href="#destinos">${lang === 'en' ? 'Destinations' : 'Destinos'}</a>`
    + `<a href="#como">${esc(t.howTitle)}</a>`
    + `<a href="#precios">${esc(t.pricesLink)}</a>`
    + `<a class="btn btn--ghost nav-tg-btn" href="${tg('header')}">${esc(t.openTelegram)}</a>`
    + `<div class="theme-pick" id="theme-pick" role="group" aria-label="${esc(t.themePrefix)}">`
    + [['system', '◐', t.themeSystem], ['light', '☀', t.themeLight], ['dark', '☾', t.themeDark]].map(([m, icon, label]) => `<button type="button" class="theme-opt" data-mode="${m}" aria-pressed="${m === 'system'}" title="${esc(label)}"><span aria-hidden="true">${icon}</span><span class="sr-only">${esc(label)}</span></button>`).join('')
    + '</div>'
    + `<a class="lang-link" href="${switchHref}" hreflang="${lang === 'en' ? 'es' : 'en'}">${esc(t.langLabel)}</a>`
    + '</nav></div></header>'
    + '<main id="contenido" tabindex="-1">'
    + '<section class="hero section" aria-labelledby="titulo">'
    + '<div class="wrap hero-grid">'
    + '<div class="hero-band" aria-hidden="true">'
    + '<svg class="hero-route" viewBox="0 0 600 120" preserveAspectRatio="xMidYMid meet" focusable="false">'
    + '<defs><linearGradient id="trail" x1="0" x2="1"><stop offset="0" stop-color="#64ffda" stop-opacity=".15"/><stop offset="1" stop-color="#64ffda"/></linearGradient></defs>'
    + '<path id="arc" d="M20 104 Q300 -36 580 104" fill="none" stroke="url(#trail)" stroke-width="2" stroke-dasharray="4 8" stroke-linecap="round"/>'
    + '<circle cx="20" cy="104" r="6" class="pin"/><circle cx="580" cy="104" r="6" class="pin"/>'
    + '<g class="plane"><path d="M14 0 L-9 -8 L-4 0 L-9 8 Z" fill="#64ffda"/>'
    + '<animateMotion dur="6s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .55 1"><mpath href="#arc"/></animateMotion></g>'
    + '</svg>'
    + '<p class="hero-route-labels"><span>COR / EZE</span><span>MAD</span></p></div>'
    + '<div class="hero-copy">'
    + `<p class="eyebrow">${esc(t.eyebrow)}</p>`
    + `<h1 id="titulo">${esc(t.h1)}</h1>`
    + `<p class="lede">${esc(t.sub)}</p>`
    + `<div class="actions"><a class="btn btn--primary" href="${tg('hero')}">${icon('i-tg')}${esc(t.ctaHero)}</a>`
    + `<a class="btn btn--ghost" href="#precios">${esc(t.seePrices)}</a></div>`
    + `<p class="micro-proof">${esc(t.micro)}</p>`
    + `<h2>${esc(t.benefitsTitle)}</h2><ul class="benefits">${benefits}</ul>`
    + '</div><div class="hero-visual">'
    + `<figure class="tg-phone-mockup"><figcaption class="sr-only">${lang === 'en' ? 'Example Flight Alert message on Telegram' : 'Ejemplo de alerta de Flight Alert en Telegram'}</figcaption>`
    + '<div class="tg-phone-shell"><div class="tg-header-bar">'
    + '<span class="tg-back-arrow">‹</span>'
    + '<img class="tg-bot-pic" src="/public/avatar.webp" alt="" width="28" height="28">'
    + '<div class="tg-info"><span class="tg-name">Flight Alert</span><span class="tg-role">bot</span></div>'
    + '</div>'
    + '<div class="tg-screen-content">'
    + `<div class="tg-sample-pill">${lang === 'en' ? 'EXAMPLE ALERT' : 'ALERTA DE EJEMPLO'}</div>`
    + '<div class="tg-msg-bubble">'
    + `<div class="tg-msg-title">✈️ <strong>${lang === 'en' ? 'Price drop detected!' : '¡Bajó el precio!'}</strong></div>`
    + '<div class="tg-msg-route"><strong>EZE</strong> (Buenos Aires) → <strong>MAD</strong> (Madrid)</div>'
    + `<div class="tg-msg-dates">📅 ${lang === 'en' ? 'Nov 12 · Return Nov 28' : '12 nov · Vuelta: 28 nov'}</div>`
    + '<div class="tg-msg-price"><span class="tg-val-now">€510</span><span class="tg-val-prev">€680</span><span class="tg-discount">-25%</span></div>'
    + `<div class="tg-msg-footer">⏱️ ${lang === 'en' ? 'Seen 2 h ago · Travelpayouts' : 'Visto hace 2 h · Travelpayouts'}</div>`
    + `<div class="tg-msg-btn">${lang === 'en' ? 'View deal ↗' : 'Ver oferta ↗'}</div>`
    + '<span class="tg-msg-timestamp">21:00 ✓✓</span>'
    + '</div></div></div></figure>'
    + `<p class="proof">${esc(t.proof)}</p>`
    + '</div></div></section>'
    + '<section class="trust-bar" aria-label="Confianza y cobertura"><div class="wrap trust-grid">'
    + `<div class="trust-item">${icon('i-takeoff', 'trust-ico')}<div><strong>${esc(t.trustOrigins)}</strong><span>${esc(t.trustOriginsList)}</span></div></div>`
    + `<div class="trust-item">${icon('i-globe', 'trust-ico')}<div><strong>${esc(t.trustDestinations)}</strong><span>${esc(t.trustDestinationsList)}</span></div></div>`
    + `<div class="trust-item">${icon('i-verified', 'trust-ico')}<div><strong>${esc(t.trustData)}</strong><span>${esc(t.trustDataDesc)}</span></div></div>`
    + `<div class="trust-item">${icon('i-shield', 'trust-ico')}<div><strong>${esc(t.trustPayments)}</strong><span>${esc(t.trustPaymentsDesc)}</span></div></div>`
    + '</div></section>'
    + '<section class="section reveal" id="como" aria-labelledby="como-titulo"><div class="wrap">'
    + `<div class="section-head"><span class="section-kicker">Simple</span><h2 id="como-titulo">${esc(t.howTitle)}</h2></div>`
    + `<ol class="steps">${steps}</ol>`
    + '</div></section>'
    + '<section class="section reveal" id="destinos" aria-labelledby="destinos-titulo"><div class="wrap">'
    + `<div class="section-head"><span class="section-kicker">${lang === 'en' ? 'Explore' : 'Explorar'}</span><h2 id="destinos-titulo">${esc(t.destinationsTitle)}</h2><p class="section-sub">${esc(t.destinationsSub)}</p></div>`
    + `<div class="dest-top"><div class="dest-gallery">${destinationCards(lang)}</div>${renderSampleCard(ctx.sample, lang)}</div>`
    + allDestinations(lang)
    + '</div></section>'
    + '<section class="section reveal" id="rutas" aria-labelledby="rutas-titulo"><div class="wrap">'
    + `<div class="section-head"><span class="section-kicker">${lang === 'en' ? 'Network' : 'Red'}</span><h2 id="rutas-titulo">${esc(t.routesTitle)}</h2></div>`
    + `<p class="fine">${esc(t.routesNote)}</p>`
    + tabs(lang)
    + panels(lang)
    + arcs
    + '</div></section>'
    + '<section class="section reveal" id="precios" aria-labelledby="precios-titulo"><div class="wrap">'
    + `<div class="section-head"><span class="section-kicker">${lang === 'en' ? 'Plans' : 'Planes'}</span><h2 id="precios-titulo">${esc(t.pricesTitle)}</h2></div>`
    + '<div class="plans">'
    + `<article class="plan plan--free"><div class="plan-head"><h3>${esc(t.freeTitle)}</h3><p class="plan-price-free">$0</p></div><p class="plan-desc">${esc(t.freeBody)}</p>`
    + '<ul class="plan-checklist">'
    + `<li>${icon('i-check')} 10 ${lang === 'en' ? 'searches per month' : 'búsquedas por mes'}</li>`
    + `<li>${icon('i-check')} ${lang === 'en' ? 'No card or registration needed' : 'Sin registro ni tarjeta'}</li>`
    + `<li>${icon('i-check')} ${lang === 'en' ? 'Travelpayouts data' : 'Datos de Travelpayouts'}</li>`
    + `<li>${icon('i-check')} ${lang === 'en' ? '7-day trial of alerts' : '7 días de prueba de la alerta'}</li>`
    + '</ul>'
    + `<a class="btn btn--ghost" href="${tg('precios')}">${esc(t.freeBtn)}</a></article>`
    + '<article class="plan plan--pro is-highlight">'
    + `<div class="badge-pro">${esc(t.proBadge)}</div>`
    + `<div class="plan-head"><h3>${esc(t.proTitle)}</h3>`
    + priceBlocks(lang, region, ars)
    + '</div>'
    + '<ul class="plan-checklist">'
    + `<li>${icon('i-check')} <strong>${lang === 'en' ? 'Unlimited searches' : 'Búsquedas ilimitadas'}</strong> (${lang === 'en' ? 'fair use' : 'uso justo'})</li>`
    + `<li>${icon('i-check')} <strong>${lang === 'en' ? 'Alert when the price drops' : 'Aviso cuando baja el precio'}</strong></li>`
    + `<li>${icon('i-check')} <strong>${lang === 'en' ? 'Daily report at 21 h (Argentina time)' : 'Reporte diario a las 21 h (hora Argentina)'}</strong></li>`
    + `<li>${icon('i-check')} ${esc(t.trial)}</li>`
    + `<li>${icon('i-check')} ${esc(t.starsPeriod)}</li>`
    + '</ul>'
    + `<div class="plan-raw-items" hidden><ul>${t.proItems.map((item) => `<li>${esc(item)}</li>`).join('')}</ul><p>${esc(t.trial)}</p><p>${esc(t.stars)}</p></div>`
    + `<a class="btn btn--primary" href="/pro">${esc(t.proBtn)}</a>`
    + '</article></div>'
    + `<fieldset class="ccy-pick" id="country-preview" data-detected="${region}"><legend>${lang === 'en' ? 'Currency' : 'Moneda'}</legend><div role="radiogroup" aria-label="${lang === 'en' ? 'Currency' : 'Moneda'}" class="ccy-group">${options}</div></fieldset>`
    + `<p class="fine">${esc(t.previewNote)}</p>`
    + `<p>${esc(t.payNote)}</p>`
    + `<p>${esc(t.cancelNote)}</p>`
    + `<p class="privacy" id="privacidad">${icon('i-lock')} ${PRIVACY}</p>`
    + privacyExtra
    + '</div></section>'
    + '<section class="section reveal" id="faq" aria-labelledby="faq-titulo"><div class="wrap">'
    + `<div class="section-head"><span class="section-kicker">FAQ</span><h2 id="faq-titulo">${esc(t.faqTitle)}</h2></div><div class="faq">${faq}</div>`
    + '</div></section>'
    + '<section class="section reveal" id="cierre" aria-labelledby="cierre-titulo"><div class="wrap">'
    + `<div class="cta-final"><h2 id="cierre-titulo">${esc(t.finalTitle)}</h2>`
    + `<a class="btn btn--primary btn--lg" href="${tg('cta')}">${icon('i-tg')}${esc(t.finalBtn)}</a></div>`
    + '</div></section>'
    + '</main>'
    + '<footer class="site-footer"><div class="wrap footer-wrap">'
    + '<div class="footer-brand"><img class="bot-logo" src="/public/avatar.webp" alt="" width="28" height="28"><strong>Flight Alert</strong></div>'
    + `<nav class="footer-nav" aria-label="${lang === 'en' ? 'Footer' : 'Pie'}">`
    + '<a href="https://ranuk.dev" target="_blank" rel="noopener">ranuk.dev</a>'
    + `<a href="${tg('footer')}">${esc(t.contact)}</a>`
    + `<a href="#privacidad">${esc(t.privacyLink)}</a>`
    + '</nav>'
    + `<p class="affiliate-notice">${esc(t.priceFoot)}</p>`
    + '<p class="footer-copy">© 2026 Ranuk IT Solutions · <a href="https://ranuk.dev" target="_blank" rel="noopener">ranuk.dev</a></p>'
    + '</div></footer>'
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
