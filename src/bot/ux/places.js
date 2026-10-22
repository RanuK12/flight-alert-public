'use strict';

const { ORIGINS, DESTINATIONS } = require('../../config/airports');

/** Nombres de los aeropuertos cubiertos. Sin inventar: solo los códigos de la config. */
const PLACES = {
  EZE: { city: 'Buenos Aires', airport: 'Ezeiza', country: 'Argentina', alias: ['bsas', 'baires', 'ezeiza'] },
  BUE: { city: 'Buenos Aires', airport: 'todos los aeropuertos', country: 'Argentina', alias: ['bsas', 'baires', 'aeroparque', 'aep'] },
  COR: { city: 'Córdoba', airport: 'Pajas Blancas', country: 'Argentina', alias: ['cba'] },
  MDQ: { city: 'Mar del Plata', airport: 'Astor Piazzolla', country: 'Argentina', alias: ['mdp', 'mar del plata'] },
  ROS: { city: 'Rosario', airport: 'Islas Malvinas', country: 'Argentina', alias: [] },
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

function codesFor(side) {
  return side === 'o' ? ORIGINS : DESTINATIONS;
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
function match(text, side) {
  const q = norm(text);
  const codes = codesFor(side);
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
  const exact = matches.length === 1 ? matches[0] : (exactOnes.length === 1 && matches.length === 1 ? exactOnes[0] : null);
  let uncovered = null;
  if (!matches.length) {
    const other = side === 'o' ? DESTINATIONS : ORIGINS;
    if (q.length === 3 && other.includes(up)) uncovered = { city: label(up), country: (PLACES[up] || {}).country || '' };
    const known = Object.keys(KNOWN_UNCOVERED).find((k) => k === q || lev(k, q) <= 1);
    if (known) uncovered = KNOWN_UNCOVERED[known];
  }
  return { exact, matches, uncovered };
}

function coveredIn(country, side) {
  return codesFor(side).filter((c) => (PLACES[c] || {}).country === country);
}

function popular(side) {
  return side === 'o' ? ORIGINS.slice() : DESTINATIONS.slice(0, 6);
}

module.exports = { PLACES, match, label, norm, lev, popular, codesFor, coveredIn };
