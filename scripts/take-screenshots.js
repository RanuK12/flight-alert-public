'use strict';

const http = require('http');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const util = require('util');
const execPromise = util.promisify(exec);
const { createApp } = require('../src/app');
const samplePrice = require('../src/services/samplePrice');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function run() {
  samplePrice.remember({
    origin: 'EZE',
    destination: 'MAD',
    departureDate: '2026-11-20',
    price: 495,
    currency: 'EUR',
    foundAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    actual: true,
  });

  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(4321, resolve));
  console.log('Server listening on port 4321');

  try {
    const targets = [
      { name: 'desktop-hero.png', size: '1280,920', url: 'http://localhost:4321/es' },
      { name: 'desktop-pricing.png', size: '1280,880', url: 'http://localhost:4321/es#precios' },
      { name: 'desktop-full.png', size: '1280,5800', url: 'http://localhost:4321/es' },
      { name: 'mobile-hero.png', size: '500,950', url: 'http://localhost:4321/es' },
      { name: 'mobile-full.png', size: '500,6200', url: 'http://localhost:4321/es' },
    ];

    for (const t of targets) {
      const dest = path.join(outDir, t.name);
      const profile = `/tmp/chrome_p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      console.log(`Capturing ${t.name} (${t.size})...`);
      const cmd = `"${CHROME}" --headless=new --disable-gpu --user-data-dir="${profile}" --hide-scrollbars --window-size=${t.size} --screenshot="${dest}" "${t.url}"`;
      try {
        await execPromise(cmd);
      } catch (e) {
        // stderr ignored
      }
      fs.rmSync(profile, { recursive: true, force: true });
      if (fs.existsSync(dest)) {
        const stat = fs.statSync(dest);
        console.log(`Saved ${t.name} (${stat.size} bytes)`);
      }
    }
  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
