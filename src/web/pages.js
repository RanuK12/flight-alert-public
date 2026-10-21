'use strict';

const copy = require('../bot/copy');
const { preselect, currencyFor, EU_COUNTRIES } = require('../services/country');

// Travelpayouts Drive. Va en el <head> de todas las páginas públicas.
const TP_DRIVE = '<script nowprocket data-noptimize="1" data-cfasync="false" data-wpfc-render="false" seraph-accel-crit="1" data-no-defer="1" data-cmp-ab="2">'
  + '(function () { var script = document.createElement("script"); script.async = 1; script.setAttribute("data-cmp-ab", "2"); script.src = "https://tp-em.com/NTg4ODIz.js?t=588823"; document.head.appendChild(script); })();'
  + '</script>';

function layout(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${TP_DRIVE}</head><body><main>${body}</main></body></html>`;
}

function home() {
  return layout('Vuelos baratos Argentina–Europa', `
    <h1>Vuelos baratos entre Argentina y Europa</h1>
    <p>Buscás una vez gratis. Después, 10 búsquedas por mes. La alerta diaria y el informe de las 21 se prueban 7 días.</p>
    <p>Entrá por Telegram y escribí /start. Si ya pagaste en la web, el bot te da un link para unir el pago con tu chat.</p>
    <p>Privacidad: el país lo estimamos con una base GeoIP local. La IP no sale del servidor.</p>
    <p><a href="/pro">Quiero Pro</a></p>
  `);
}

function countryOptions(suggested) {
  const rows = [['AR', 'Argentina'], ...EU_COUNTRIES, ['OTRO', 'Otro']];
  return rows.map(([code, name]) => (
    `<option value="${code}" ${suggested === code ? 'selected' : ''}>${name}</option>`
  )).join('');
}

function pro({ choice = '', ipCountry: geo = '', language = '' } = {}) {
  const suggested = String(choice || preselect(language) || '').toUpperCase();
  const offer = currencyFor(suggested, geo);
  const priceLine = offer.currency === 'ARS'
    ? 'Vas a pagar en pesos, al valor del día.'
    : offer.currency === 'EUR'
      ? 'Son €4,50 por mes, IVA incluido.'
      : 'Son USD 5 por mes.';
  const note = offer.rail === 'mp'
    ? 'Podés pagar en pesos con Mercado Pago.'
    : 'El pago en pesos solo aparece si elegís Argentina y estás en Argentina.';
  return layout('Pro', `
    <h1>Pro</h1>
    <p>${note}</p>
    <p>${priceLine}</p>
    <form method="post" action="/pro/checkout">
      <label>País
        <select name="pais">
          ${countryOptions(suggested)}
        </select>
      </label>
      <label>Email <input name="email" type="email" required></label>
      <button type="submit">${offer.rail === 'mp' ? 'Seguir con Mercado Pago' : 'Seguir con tarjeta'}</button>
    </form>
    <p>En el bot, Pro se paga solo con estrellas de Telegram. Este sitio no pide datos de tarjeta.</p>
  `);
}

function listo(url) {
  const link = url
    ? `<p>Abrí este link en el teléfono (vale 15 minutos, una sola vez): <a href="${url}">${url}</a></p>`
    : '<p>Falta el nombre del bot para armar el link.</p>';
  return layout('Listo', `<h1>Listo</h1>${link}<p>Cuando se acredite el pago, las alertas que tenías pausadas vuelven como estaban.</p>`);
}

function maintenance() {
  return layout('Mantenimiento', `<p>${copy.maintenance}</p>`);
}

module.exports = { home, pro, listo, maintenance };
