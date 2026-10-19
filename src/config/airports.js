'use strict';

/** Los mismos 5 orígenes y 31 destinos del monitor AR↔EU. */
const ORIGINS = ['EZE', 'COR', 'MDQ', 'ROS', 'BUE'];

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

module.exports = { ORIGINS, DESTINATIONS, allPairs };
