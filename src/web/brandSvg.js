'use strict';

/**
 * Shared brand SVG marks for Flight Alert and Ranuk IT Solutions.
 * Inline SVGs work under strict default-src 'self' CSP without extra requests.
 */

/** Mint paper-plane emblem over deep navy matching reportPdf.js:30-35. */
function flightAlertLogoSvg({ size = 36, cls = 'bot-logo' } = {}) {
  const s = Number(size) || 36;
  const c = cls ? ` class="${cls}"` : '';
  return `<svg${c} width="${s}" height="${s}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">`
    + '<rect width="32" height="32" rx="8" fill="#112240"/>'
    + '<polygon points="7,16 26,7 20,26 16,19" fill="#64ffda"/>'
    + '<polygon points="16,19 26,7 14,24" fill="#3fcfae"/>'
    + '</svg>';
}

/**
 * Ranuk IT Solutions geometric "R}" monogram inspired by the studio mark.
 * Uses crisp cyan gradient over midnight slate for high legibility at small sizes.
 */
function ranukMarkSvg({ size = 20, cls = 'ranuk-mark' } = {}) {
  const s = Number(size) || 20;
  const c = cls ? ` class="${cls}"` : '';
  return `<svg${c} width="${s}" height="${s}" viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">`
    + '<rect width="32" height="32" rx="7" fill="#0f172a"/>'
    + '<path d="M8 9h6.2a4.3 4.3 0 0 1 0 8.6H11.5V23H8V9zm3.5 3v2.7h2.5a1.35 1.35 0 0 0 0-2.7h-2.5zm3.3 5.2L18.4 23h-3.7l-3.1-5.8h3.2z" fill="#38bdf8"/>'
    + '<path d="M20.2 9.2c1.6 0 2.5.8 2.5 2.4v2.1c0 .9.5 1.5 1.5 1.7v1.2c-1 .2-1.5.8-1.5 1.7v2.1c0 1.6-.9 2.4-2.5 2.4" stroke="#64ffda" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
    + '</svg>';
}

module.exports = { flightAlertLogoSvg, ranukMarkSvg };
