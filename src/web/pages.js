'use strict';

const copy = require('../bot/copy');
const { rail, preselect } = require('../services/country');

function layout(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body><main>${body}</main></body></html>`;
}

function home() {
  return layout('Vuelos baratos Argentina–Europa', `
    <h1>Vuelos baratos entre Argentina y Europa</h1>
    <p>Buscás una vez gratis. Después, 10 búsquedas por mes. La alerta diaria y el informe de las 21 se prueban 7 días.</p>
    <p>Entrá por Telegram y escribí /start. Si ya pagaste en la web, el bot te da un link para unir el pago con tu chat.</p>
    <p><a href="/pro">Quiero Pro</a></p>
  `);
}

function pro(req) {
  const choice = String((req.query && req.query.pais) || '');
  const ip = String(req.headers['cf-ipcountry'] || req.headers['x-geo-country'] || '').toUpperCase();
  const suggested = choice || preselect(req.headers['accept-language']);
  const method = rail({ choice: suggested, ipCountry: ip });
  const note = method === 'mp'
    ? 'Podés pagar en pesos con Mercado Pago.'
    : 'El pago en pesos solo aparece si elegís Argentina y estás en Argentina. Si no, es con tarjeta en dólares o euros.';
  return layout('Pro', `
    <h1>Pro</h1>
    <p>${note}</p>
    <form method="post" action="/pro/checkout">
      <label>País
        <select name="pais">
          <option value="AR" ${suggested === 'AR' ? 'selected' : ''}>Argentina</option>
          <option value="ES" ${suggested === 'ES' ? 'selected' : ''}>España</option>
          <option value="OTRO" ${suggested !== 'AR' && suggested !== 'ES' ? 'selected' : ''}>Otro</option>
        </select>
      </label>
      <label>Email <input name="email" type="email" required></label>
      <button type="submit">${method === 'mp' ? 'Seguir con Mercado Pago' : 'Seguir con tarjeta'}</button>
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
