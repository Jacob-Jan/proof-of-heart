import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const checks = [
  {
    route: '/',
    file: 'src/app/charities/charities.ts',
    mustContain: ["'@context': 'https://schema.org'", "'@type': 'CollectionPage'", "'@type': 'NGO'"]
  },
  {
    route: '/charities/:pubkey',
    file: 'src/app/charity-detail/charity-detail.ts',
    mustContain: ["'@context': 'https://schema.org'", "'@type': 'NGO'", "'@type': 'DonateAction'"]
  },
  {
    route: '/bitcoin-charities',
    file: 'src/app/app.routes.ts',
    mustContain: ["path: 'bitcoin-charities'", "canonicalPath: '/bitcoin-charities'"]
  },
  {
    route: '/bitcoin-donations',
    file: 'src/app/app.routes.ts',
    mustContain: ["path: 'bitcoin-donations'", "canonicalPath: '/bitcoin-donations'"]
  }
];

let failed = false;
for (const check of checks) {
  const fullPath = path.join(ROOT, check.file);
  const text = await readFile(fullPath, 'utf8');
  const missing = check.mustContain.filter((s) => !text.includes(s));
  if (missing.length) {
    failed = true;
    console.error(`[schema-check] FAIL ${check.route} (${check.file})`);
    for (const m of missing) console.error(`  missing: ${m}`);
  } else {
    console.log(`[schema-check] PASS ${check.route}`);
  }
}

if (failed) {
  process.exit(1);
}
