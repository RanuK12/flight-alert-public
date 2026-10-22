'use strict';

const pages = require('../src/web/pages');

test('sin Travelpayouts Drive: ninguna página carga tp-em.com', () => {
  const html = pages.home();
  expect(html).not.toContain('tp-em.com');
  expect(html).not.toContain('data-cmp-ab');
});
