'use strict';

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

const AR_ORIGINS = ORIGIN_GROUPS[0].codes.slice();
const ORIGINS = ORIGIN_GROUPS.flatMap((g) => g.codes);

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

function allPairs() {
  const pairs = [];
  for (const origin of ORIGINS) {
    for (const destination of DESTINATIONS) {
      pairs.push({ origin, destination });
    }
  }
  return pairs;
}

function groupOf(code) {
  return ORIGIN_GROUPS.find((g) => g.codes.includes(code)) || null;
}

module.exports = { ORIGINS, AR_ORIGINS, ORIGIN_GROUPS, DESTINATIONS, allPairs, groupOf };
