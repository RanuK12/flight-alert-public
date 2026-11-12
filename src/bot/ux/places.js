'use strict';

const {
  ORIGINS, DESTINATIONS, ORIGIN_GROUPS, ALL_ORIGINS, EU_RETURN_HUBS, destinationsFor,
  activeDestinations, activeAllOrigins,
} = require('../../config/airports');

/** Nombres de los aeropuertos cubiertos. Sin inventar: solo los códigos de la config. */
const PLACES = {
  EZE: { city: 'Buenos Aires', airport: 'Ezeiza', country: 'Argentina', alias: ['bsas', 'baires', 'ezeiza'] },
  BUE: { city: 'Buenos Aires', airport: 'todos los aeropuertos', country: 'Argentina', alias: ['bsas', 'baires', 'aeroparque', 'aep'] },
  COR: { city: 'Córdoba', airport: 'Pajas Blancas', country: 'Argentina', alias: ['cba'] },
  MDQ: { city: 'Mar del Plata', airport: 'Astor Piazzolla', country: 'Argentina', alias: ['mdp', 'mar del plata'] },
  ROS: { city: 'Rosario', airport: 'Islas Malvinas', country: 'Argentina', alias: [] },
  GRU: { city: 'São Paulo', airport: 'Guarulhos', country: 'Brasil', alias: ['sao paulo', 'san pablo', 'sao pablo', 'sp'] },
  GIG: { city: 'Río de Janeiro', airport: 'Galeão', country: 'Brasil', alias: ['rio', 'rio de janeiro', 'galeao', 'buzios', 'copacabana'] },
  SCL: { city: 'Santiago de Chile', airport: 'Arturo Merino Benítez', country: 'Chile', alias: ['santiago', 'stgo'] },
  MVD: { city: 'Montevideo', airport: 'Carrasco', country: 'Uruguay', alias: ['mvd'] },
  LIM: { city: 'Lima', airport: 'Jorge Chávez', country: 'Perú', alias: [] },
  BOG: { city: 'Bogotá', airport: 'El Dorado', country: 'Colombia', alias: ['bogota'] },
  MEX: { city: 'Ciudad de México', airport: 'Benito Juárez', country: 'México', alias: ['cdmx', 'mexico', 'df'] },
  ASU: { city: 'Asunción', airport: 'Silvio Pettirossi', country: 'Paraguay', alias: ['asuncion', 'paraguay'] },
  MAD: { city: 'Madrid', airport: 'Barajas', country: 'España', alias: [] },
  BCN: { city: 'Barcelona', airport: 'El Prat', country: 'España', alias: [] },
  SVQ: { city: 'Sevilla', airport: 'San Pablo', country: 'España', alias: ['seville'] },
  VLC: { city: 'Valencia', airport: 'Manises', country: 'España', alias: [] },
  BIO: { city: 'Bilbao', airport: 'Loiu', country: 'España', alias: [] },
  FCO: { city: 'Roma', airport: 'Fiumicino', country: 'Italia', alias: ['rome'] },
  MXP: { city: 'Milán', airport: 'Malpensa', country: 'Italia', alias: ['milan', 'milano'] },
  NAP: { city: 'Nápoles', airport: 'Capodichino', country: 'Italia', alias: ['naples', 'napoli'] },
  VCE: { city: 'Venecia', airport: 'Marco Polo', country: 'Italia', alias: ['venice', 'venezia'] },
  BGY: { city: 'Bérgamo', airport: 'Orio al Serio', country: 'Italia', alias: ['bergamo'] },
  CDG: { city: 'París', airport: 'Charles de Gaulle', country: 'Francia', alias: ['paris'] },
  ORY: { city: 'París', airport: 'Orly', country: 'Francia', alias: ['paris'] },
  NCE: { city: 'Niza', airport: 'Côte d\'Azur', country: 'Francia', alias: ['nice'] },
  LYS: { city: 'Lyon', airport: 'Saint-Exupéry', country: 'Francia', alias: [] },
  LHR: { city: 'Londres', airport: 'Heathrow', country: 'Reino Unido', alias: ['london'] },
  LGW: { city: 'Londres', airport: 'Gatwick', country: 'Reino Unido', alias: ['london'] },
  STN: { city: 'Londres', airport: 'Stansted', country: 'Reino Unido', alias: ['london'] },
  DUB: { city: 'Dublín', airport: 'Dublin', country: 'Irlanda', alias: ['dublin'] },
  AMS: { city: 'Ámsterdam', airport: 'Schiphol', country: 'Países Bajos', alias: ['amsterdam'] },
  BRU: { city: 'Bruselas', airport: 'Zaventem', country: 'Bélgica', alias: ['brussels', 'bruxelles'] },
  FRA: { city: 'Fráncfort', airport: 'Frankfurt', country: 'Alemania', alias: ['frankfurt'] },
  MUC: { city: 'Múnich', airport: 'Franz Josef Strauss', country: 'Alemania', alias: ['munich', 'munchen'] },
  BER: { city: 'Berlín', airport: 'Brandenburg', country: 'Alemania', alias: ['berlin'] },
  DUS: { city: 'Düsseldorf', airport: 'Düsseldorf', country: 'Alemania', alias: ['dusseldorf'] },
  HAM: { city: 'Hamburgo', airport: 'Hamburg', country: 'Alemania', alias: ['hamburg'] },
  LIS: { city: 'Lisboa', airport: 'Humberto Delgado', country: 'Portugal', alias: ['lisbon'] },
  OPO: { city: 'Oporto', airport: 'Francisco Sá Carneiro', country: 'Portugal', alias: ['porto'] },
  VIE: { city: 'Viena', airport: 'Schwechat', country: 'Austria', alias: ['vienna', 'wien'] },
  ZRH: { city: 'Zúrich', airport: 'Kloten', country: 'Suiza', alias: ['zurich'] },
  ATH: { city: 'Atenas', airport: 'Eleftherios Venizelos', country: 'Grecia', alias: ['athens'] },
  IST: { city: 'Estambul', airport: 'Istanbul', country: 'Turquía', alias: ['istanbul'] },
  MIA: { city: 'Miami', airport: 'Miami International', country: 'Estados Unidos', alias: ['eeuu', 'usa'] },
  JFK: { city: 'Nueva York', airport: 'John F. Kennedy', country: 'Estados Unidos', alias: ['new york', 'nyc', 'eeuu'] },
  LAX: { city: 'Los Ángeles', airport: 'Los Angeles', country: 'Estados Unidos', alias: ['los angeles', 'eeuu'] },
  ORD: { city: 'Chicago', airport: 'O\'Hare', country: 'Estados Unidos', alias: ['ohare'] },
  DFW: { city: 'Dallas', airport: 'Dallas/Fort Worth', country: 'Estados Unidos', alias: ['fort worth'] },
  SFO: { city: 'San Francisco', airport: 'San Francisco', country: 'Estados Unidos', alias: ['sf'] },
  ATL: { city: 'Atlanta', airport: 'Hartsfield-Jackson', country: 'Estados Unidos', alias: [] },
  MCO: { city: 'Orlando', airport: 'Orlando International', country: 'Estados Unidos', alias: ['disney'] },
  PVG: { city: 'Shanghái', airport: 'Pudong', country: 'China', alias: ['shanghai', 'shangai'] },
  PEK: { city: 'Pekín', airport: 'Capital', country: 'China', alias: ['beijing', 'pekin'] },
  CAN: { city: 'Cantón', airport: 'Baiyun', country: 'China', alias: ['guangzhou', 'canton'] },
  BKK: { city: 'Bangkok', airport: 'Suvarnabhumi', country: 'Tailandia', alias: ['thailand', 'tailandia'] },
  HKT: { city: 'Phuket', airport: 'Phuket International', country: 'Tailandia', alias: ['thailand', 'tailandia'] },
  SIN: { city: 'Singapur', airport: 'Changi', country: 'Singapur', alias: ['singapore', 'changi'] },
  AUA: { city: 'Aruba', airport: 'Queen Beatrix', country: 'Aruba', alias: ['oranjestad', 'caribe', 'caribbean'] },
  PUJ: { city: 'Punta Cana', airport: 'Punta Cana International', country: 'República Dominicana', alias: ['bavaro', 'dominicana', 'caribe', 'caribbean'] },
  CUN: { city: 'Cancún', airport: 'Cancún International', country: 'México', alias: ['cancun', 'riviera maya', 'playa del carmen', 'tulum', 'caribe'] },
  SDQ: { city: 'Santo Domingo', airport: 'Las Américas', country: 'República Dominicana', alias: ['dominicana', 'caribe'] },
  HAV: { city: 'La Habana', airport: 'José Martí', country: 'Cuba', alias: ['habana', 'havana', 'varadero', 'cuba', 'caribe'] },
  SJU: { city: 'San Juan', airport: 'Luis Muñoz Marín', country: 'Puerto Rico', alias: ['puerto rico', 'caribe'] },
  CUR: { city: 'Curazao', airport: 'Hato', country: 'Curazao', alias: ['curacao', 'willemstad', 'caribe'] },
  MBJ: { city: 'Montego Bay', airport: 'Sangster', country: 'Jamaica', alias: ['jamaica', 'negril', 'caribe'] },
  NAS: { city: 'Nassau', airport: 'Lynden Pindling', country: 'Bahamas', alias: ['bahamas', 'caribe'] },
  SXM: { city: 'Sint Maarten', airport: 'Princess Juliana', country: 'Sint Maarten', alias: ['st maarten', 'san martin', 'caribe'] },
  FLN: { city: 'Florianópolis', airport: 'Hercílio Luz', country: 'Brasil', alias: ['florianopolis', 'floripa', 'canasvieiras', 'canas vieiras', 'ingleses', 'jurere', 'brasil', 'brazil'] },
  NVT: { city: 'Camboriú / Navegantes', airport: 'Ministro Victor Konder', country: 'Brasil', alias: ['camboriu', 'balneario camboriu', 'navegantes', 'itajai', 'bombinhas', 'brasil'] },
  NAT: { city: 'Natal / Pipa', airport: 'São Gonçalo do Amarante', country: 'Brasil', alias: ['pipa', 'praia da pipa', 'natal', 'ponta negra', 'brasil'] },
  MCZ: { city: 'Maceió', airport: 'Zumbi dos Palmares', country: 'Brasil', alias: ['maceio', 'maragogi', 'alagoas', 'brasil'] },
  BPS: { city: 'Porto Seguro', airport: 'Porto Seguro', country: 'Brasil', alias: ['arraial', 'trancoso', 'bahia', 'brasil'] },
  SSA: { city: 'Salvador de Bahía', airport: 'Deputado Luís Eduardo Magalhães', country: 'Brasil', alias: ['salvador', 'bahia', 'morro de sao paulo', 'brasil'] },
  REC: { city: 'Recife', airport: 'Guararapes', country: 'Brasil', alias: ['recife', 'porto de galinhas', 'brasil'] },
  FOR: { city: 'Fortaleza', airport: 'Pinto Martins', country: 'Brasil', alias: ['fortaleza', 'jericoacoara', 'jeri', 'brasil'] },
  PDP: { city: 'Punta del Este', airport: 'Laguna del Sauce', country: 'Uruguay', alias: ['punta', 'maldonado', 'uruguay'] },
};

/** Ciudades conocidas pero no cubiertas (para avisar en vez de "no encontré"). */
const KNOWN_UNCOVERED = {
  mendoza: { city: 'Mendoza', country: 'Argentina' },
  salta: { city: 'Salta', country: 'Argentina' },
  tucuman: { city: 'Tucumán', country: 'Argentina' },
  bariloche: { city: 'Bariloche', country: 'Argentina' },
  ushuaia: { city: 'Ushuaia', country: 'Argentina' },
  neuquen: { city: 'Neuquén', country: 'Argentina' },
  malaga: { city: 'Málaga', country: 'España' },
  palma: { city: 'Palma', country: 'España' },
  florencia: { city: 'Florencia', country: 'Italia' },
  praga: { city: 'Praga', country: 'Chequia' },
  budapest: { city: 'Budapest', country: 'Hungría' },
};

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** side 'o': LATAM + Europa/destinos (vuelta). side 'd': según el origen elegido. */
function codesFor(side, origin) {
  const cov = require('../../config/coverage');
  if (side === 'o') return activeAllOrigins().filter(cov.originAvailable);
  return origin ? cov.destinationsAvailable(origin) : activeDestinations();
}

function label(code) {
  const p = PLACES[code];
  if (!p) return code;
  return code === 'BUE' ? `${p.city}, todos (BUE)` : `${p.city} (${code})`;
}

/**
 * Busca en los códigos cubiertos del lado pedido.
 * Orden: IATA exacto > ciudad/alias empieza con > contiene > Levenshtein ≤ 2.
 * Devuelve { exact, matches, uncovered }.
 */
function match(text, side, origin) {
  const q = norm(text);
  const codes = codesFor(side, origin);
  if (!q) return { exact: null, matches: [], uncovered: null };
  const up = q.toUpperCase();
  if (q.length === 3 && codes.includes(up)) return { exact: up, matches: [up], uncovered: null };
  const scored = [];
  for (const code of codes) {
    const p = PLACES[code] || { city: code, airport: '', alias: [] };
    const names = [p.city, p.airport, ...(p.alias || [])].map(norm).filter(Boolean);
    let score = null;
    if (names.some((n) => n === q)) score = 0;
    else if (names.some((n) => n.startsWith(q))) score = 1;
    else if (names.some((n) => n.includes(q))) score = 2;
    else {
      const best = Math.min(...names.map((n) => lev(n, q)));
      if (best <= 2) score = 3 + best;
    }
    if (score !== null) scored.push({ code, score });
  }
  scored.sort((a, b) => a.score - b.score || codes.indexOf(a.code) - codes.indexOf(b.code));
  const matches = scored.map((s) => s.code);
  const exactOnes = scored.filter((s) => s.score === 0).map((s) => s.code);
  // Un único nombre exacto gana si el resto son sólo parecidos tipográficos (p. ej. "sao paulo" vs aeropuerto "San Pablo" de SVQ).
  const closeOthers = scored.filter((s) => s.score > 0 && s.score < 3).length;
  const exact = matches.length === 1 ? matches[0] : (exactOnes.length === 1 && !closeOthers ? exactOnes[0] : null);
  let uncovered = null;
  if (!matches.length) {
    const other = side === 'o' ? [] : activeAllOrigins().filter((c) => !codes.includes(c));
    if (q.length === 3 && other.includes(up)) uncovered = { city: label(up), country: (PLACES[up] || {}).country || '' };
    const known = Object.keys(KNOWN_UNCOVERED).find((k) => k === q || lev(k, q) <= 1);
    if (known) uncovered = KNOWN_UNCOVERED[known];
  }
  return { exact, matches, uncovered };
}

function coveredIn(country, side, origin) {
  return codesFor(side, origin).filter((c) => (PLACES[c] || {}).country === country);
}

function popular(side, origin) {
  const cov = require('../../config/coverage');
  if (side === 'o') return cov.latamOriginsAvailable();
  return (origin ? cov.destinationsAvailable(origin) : activeDestinations()).slice(0, 6);
}

/**
 * Filas del selector de origen agrupadas por país: una fila-título (noop) y los botones del país.
 * btn(code) arma el botón. Argentina va primero, igual que antes.
 */
const EU_RETURN_TITLES = { es: '🇪🇺 Vuelta desde Europa', en: '🇪🇺 Return from Europe', pt: '🇪🇺 Volta da Europa' };
const EU_RETURN_TITLE = EU_RETURN_TITLES.es;
const GROUP_NAMES_EN = { BR: 'Brazil', PE: 'Peru', MX: 'Mexico', PY: 'Paraguay' };

function originRows(btn, per = 2, lang = 'es') {
  const cov = require('../../config/coverage');
  const rows = [];
  for (const g of cov.groupsAvailable()) {
    const name = lang === 'en' ? (GROUP_NAMES_EN[g.country] || g.name) : g.name;
    rows.push([{ text: `${g.flag} ${name}`, callback_data: 'noop' }]);
    for (let i = 0; i < g.codes.length; i += per) rows.push(g.codes.slice(i, i + per).map(btn));
  }
  const hubs = cov.euHubsAvailable();
  if (hubs.length) {
    rows.push([{ text: EU_RETURN_TITLES[lang] || EU_RETURN_TITLE, callback_data: 'noop' }]);
    for (let i = 0; i < hubs.length; i += per) rows.push(hubs.slice(i, i + per).map(btn));
  }
  return rows;
}

module.exports = { EU_RETURN_TITLE, EU_RETURN_TITLES, PLACES, match, label, norm, lev, popular, codesFor, coveredIn, originRows };
