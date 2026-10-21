'use strict';

const pages = require('../src/web/pages');

test('home lleva el script de Travelpayouts Drive en el head', () => {
  const html = pages.home();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('https://tp-em.com/NTg4ODIz.js?t=588823');
  expect(head).toContain('data-cmp-ab');
});
