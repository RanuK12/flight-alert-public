'use strict';

const flags = require('./flags');

/**
 * Orígenes agrupados por país (el selector del bot los muestra así).
 * Argentina primero y en el mismo orden de siempre; después los hubs de Latinoamérica.
 */
const ORIGIN_GROUPS = [
  { country: 'AR', name: 'Argentina', flag: '🇦🇷', codes: ['EZE', 'COR', 'MDQ', 'ROS', 'BUE'] },
  { country: 'BR', name: 'Brasil', flag: '🇧🇷', codes: ['GRU', 'GIG'] },
  { country: 'CL', name: 'Chile', flag: '🇨🇱', codes: ['SCL'] },
  { country: 'UY', name: 'Uruguay', flag: '🇺🇾', codes: ['MVD'] },
  { country: 'PE', name: 'Perú', flag: '🇵🇪', codes: ['LIM'] },
  { country: 'CO', name: 'Colombia', flag: '🇨🇴', codes: ['BOG'] },
  { country: 'MX', name: 'México', flag: '🇲🇽', codes: ['MEX'] },
];

const F3_ORIGIN_GROUPS = [
  { country: 'PY', name: 'Paraguay', flag: '🇵🇾', codes: ['ASU'] },
];

const AR_ORIGINS = ORIGIN_GROUPS[0].codes.slice();
const ORIGINS = ORIGIN_GROUPS.flatMap((g) => g.codes);
const F3_ORIGINS = F3_ORIGIN_GROUPS.flatMap((g) => g.codes);

const DESTINATIONS = [
  'MAD', 'BCN', 'SVQ', 'VLC', 'BIO',
  'FCO', 'MXP', 'NAP', 'VCE', 'BGY',
  'CDG', 'ORY', 'NCE', 'LYS',
  'LHR', 'LGW', 'STN', 'DUB',
  'AMS', 'BRU',
  'FRA', 'MUC', 'BER', 'DUS', 'HAM',
  'LIS', 'OPO',
  'VIE', 'ZRH', 'ATH', 'IST',
];

const F3_DESTINATION_GROUPS = {
  US: ['MIA', 'JFK', 'LAX', 'ORD', 'DFW', 'SFO', 'ATL', 'MCO'],
  CN: ['PVG', 'PEK', 'CAN'],
  TH: ['BKK', 'HKT'],
  SG: ['SIN'],
};
const F3_DESTINATIONS = Object.values(F3_DESTINATION_GROUPS).flat();

function activeOriginGroups() {
  return flags.f3Destinations() ? [...ORIGIN_GROUPS, ...F3_ORIGIN_GROUPS] : ORIGIN_GROUPS;
}

function activeOrigins() {
  return flags.f3Destinations() ? [...ORIGINS, ...F3_ORIGINS] : ORIGINS;
}

function activeDestinations() {
  return flags.f3Destinations() ? [...DESTINATIONS, ...F3_DESTINATIONS] : DESTINATIONS;
}

function activeAllOrigins() {
  return [...activeOrigins(), ...activeDestinations()];
}

/** Ida LATAM→Europa/F3 y vuelta destino→LATAM (lo que mide el chequeo de cobertura). */
function allPairs(opts = {}) {
  const includeF3 = opts && opts.includeF3 !== undefined ? Boolean(opts.includeF3) : flags.f3Destinations();
  const orig = includeF3 ? [...ORIGINS, ...F3_ORIGINS] : ORIGINS;
  const dest = includeF3 ? [...DESTINATIONS, ...F3_DESTINATIONS] : DESTINATIONS;
  const pairs = [];
  for (const origin of orig) {
    for (const destination of dest) {
      pairs.push({ origin, destination });
    }
  }
  for (const origin of dest) {
    for (const destination of orig) {
      pairs.push({ origin, destination });
    }
  }
  return pairs;
}

/** Vuelta Europa → Latinoamérica: hubs que se muestran en el selector (el resto se encuentra escribiendo). */
const EU_RETURN_HUBS = ['MAD', 'BCN', 'FCO', 'MXP', 'LIS', 'CDG', 'LHR', 'FRA'];
const ALL_ORIGINS = [...ORIGINS, ...DESTINATIONS];

function isEurope(code) {
  return DESTINATIONS.includes(code);
}

function isDestination(code) {
  return activeDestinations().includes(code);
}

/** Destinos válidos para un origen: desde LATAM → Europa (+F3); desde destino → LATAM (vuelta). */
function destinationsFor(origin) {
  if (isDestination(origin)) return activeOrigins().slice();
  if (activeOrigins().includes(origin)) return activeDestinations().slice();
  return [];
}

/** Par válido: LATAM→Destino o Destino→LATAM. Nunca Destino↔Destino ni LATAM↔LATAM. */
function pairOk(origin, destination) {
  const orig = activeOrigins();
  const dest = activeDestinations();
  return (orig.includes(origin) && dest.includes(destination))
    || (dest.includes(origin) && orig.includes(destination));
}

function groupOf(code) {
  return [...ORIGIN_GROUPS, ...F3_ORIGIN_GROUPS].find((g) => g.codes.includes(code)) || null;
}

module.exports = {
  ORIGINS,
  AR_ORIGINS,
  ORIGIN_GROUPS,
  DESTINATIONS,
  EU_RETURN_HUBS,
  ALL_ORIGINS,
  F3_ORIGIN_GROUPS,
  F3_ORIGINS,
  F3_DESTINATION_GROUPS,
  F3_DESTINATIONS,
  activeOriginGroups,
  activeOrigins,
  activeDestinations,
  activeAllOrigins,
  allPairs,
  groupOf,
  isEurope,
  isDestination,
  destinationsFor,
  pairOk,
};
