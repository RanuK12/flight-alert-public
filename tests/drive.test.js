'use strict';

const pages = require('../src/web/pages');

test('home lleva el script de Travelpayouts Drive en el head', () => {
  const html = pages.home();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('https://emrldtp.cc/NTg4ODA4.js?t=588808');
  expect(head).toContain('data-cmp-ab');
});
