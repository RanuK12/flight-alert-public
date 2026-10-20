'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

test('P15. el repo no tiene tokens, uris ni ids de chat', () => {
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'no-secrets.js')], {
    encoding: 'utf8',
  });
  expect(out).toContain('sin secretos');
});
