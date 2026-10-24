import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️';
let passed = 0, failed = 0;

function report(name, ok, detail) {
  if (ok) { passed++; console.log(`${PASS} ${name}`); }
  else { failed++; console.log(`${FAIL} ${name}${detail ? ': ' + detail : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('=== Open PDF Studio Integration Test ===\n');

  // 1. Load app
  console.log('--- Loading app ---');
  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);
  report('App loads', true);

  // 2. Check for console errors
  console.log('\n--- Console errors ---');
  const relevantErrors = consoleErrors.filter(e =>
    !e.includes('plugin-manager') && !e.includes('favicon')
  );
  if (relevantErrors.length === 0) {
    report('No relevant console errors', true);
  } else {
    report('Console errors found', false);
    relevantErrors.forEach(e => console.log('  ERROR:', e.substring(0, 200)));
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
