'use strict';
const pages = require('../src/web/pages');
const { hashes } = require('../src/web/landing');

test('/pro usa la hoja de la landing y el copy nuevo', () => {
  const html = pages.pro({ choice: 'ES', nonce: 'n1' });
  expect(html).toContain(`/assets/styles.${hashes.css}.css`);
  expect(html).toContain('<style nonce="n1">');
  expect(html).toContain('Te avisamos cuando un precio baja de tu techo');
  expect(html).toContain('Búsquedas ilimitadas (uso justo)');
  expect(html).not.toMatch(/aviso al instante|anti-abuso|BNA/);
});

test('precio según país: AR dólar oficial, UE IVA incluido, resto US$5', () => {
  const ar = pages.pro({ choice: 'AR', ipCountry: 'AR', ars: 7350 });
  expect(ar).toMatch(/id="pro-price"[^>]*>\$\s?7\.350 por mes, al dólar oficial de hoy\./);
  expect(pages.pro({ choice: 'ES' })).toContain('>€4,50 por mes, IVA incluido.<');
  expect(pages.pro({ choice: 'OTRO' })).toContain('>US$5 por mes.<');
  expect(pages.pro({ choice: 'AR', ipCountry: 'AR' })).toContain('Sin cotización del dólar oficial');
});

test('formulario: labels con for, botón menta 48px y error de email', () => {
  const html = pages.pro({});
  expect(html).toContain('<label for="pro-pais">');
  expect(html).toContain('<label for="pro-email">');
  expect(html).toContain('id="pro-email"');
  expect(html).toContain('class="btn btn--primary pro-submit"');
  expect(html).toMatch(/id="pro-email-error"[^>]*role="alert"[^>]*hidden/);
  expect(html).toContain('aria-describedby="pro-email-error"');
});
