import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const SITE_URL = process.env.SITE_URL || 'https://proofofheart.org';
const KIND_CHARITY_PROFILE = 30078;
const D_TAG = 'proofofheart-charity-profile-v1';

const RELAYS = (process.env.SITEMAP_RELAYS
  ? process.env.SITEMAP_RELAYS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'wss://relay.damus.io',
      'wss://relay.primal.net',
      'wss://nostr.wine',
      'wss://relay.snort.social'
    ]);

const STATIC_ROUTES = [
  { path: '/', changefreq: 'daily', priority: '1.0' },
  { path: '/paper', changefreq: 'weekly', priority: '0.8' },
  { path: '/bitcoin-charities', changefreq: 'weekly', priority: '0.8' },
  { path: '/bitcoin-donations', changefreq: 'weekly', priority: '0.8' },
  { path: '/proof-of-heart', changefreq: 'monthly', priority: '0.7' },
  { path: '/partner', changefreq: 'monthly', priority: '0.6' }
];

const toIsoDay = (unixSeconds) => {
  if (!unixSeconds) return undefined;
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
};

const escapeXml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const makeUrlset = (entries) => {
  const urls = entries
    .map((entry) => {
      const lines = [
        '  <url>',
        `    <loc>${escapeXml(entry.loc)}</loc>`
      ];
      if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      if (entry.changefreq) lines.push(`    <changefreq>${escapeXml(entry.changefreq)}</changefreq>`);
      if (entry.priority) lines.push(`    <priority>${escapeXml(entry.priority)}</priority>`);
      lines.push('  </url>');
      return lines.join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const makeSitemapIndex = (entries) => {
  const nodes = entries
    .map((entry) => {
      const lines = [
        '  <sitemap>',
        `    <loc>${escapeXml(entry.loc)}</loc>`
      ];
      if (entry.lastmod) lines.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
      lines.push('  </sitemap>');
      return lines.join('\n');
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${nodes}\n</sitemapindex>\n`;
};

async function fetchCharityEvents() {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(RELAYS, {
      kinds: [KIND_CHARITY_PROFILE],
      limit: 5000
    });

    const latestByPubkey = new Map();
    for (const event of events) {
      const dTag = (event.tags || []).find((t) => t?.[0] === 'd')?.[1];
      if (dTag !== D_TAG) continue;
      const prev = latestByPubkey.get(event.pubkey);
      if (!prev || (event.created_at || 0) > (prev.created_at || 0)) {
        latestByPubkey.set(event.pubkey, event);
      }
    }

    const result = [];
    for (const event of latestByPubkey.values()) {
      let isVisible = true;
      try {
        const parsed = JSON.parse(event.content || '{}');
        if (typeof parsed?.isVisible === 'boolean') isVisible = parsed.isVisible;
      } catch {
        // keep default
      }
      if (!isVisible) continue;

      let npub;
      try {
        npub = nip19.npubEncode(event.pubkey);
      } catch {
        continue;
      }

      result.push({
        loc: `${SITE_URL}/charities/${npub}`,
        lastmod: toIsoDay(event.created_at),
        changefreq: 'daily',
        priority: '0.8'
      });
    }

    result.sort((a, b) => a.loc.localeCompare(b.loc));
    return result;
  } finally {
    pool.close(RELAYS);
  }
}

async function main() {
  const now = new Date().toISOString().slice(0, 10);

  const staticEntries = STATIC_ROUTES.map((r) => ({
    loc: `${SITE_URL}${r.path}`,
    changefreq: r.changefreq,
    priority: r.priority
  }));

  let charityEntries = [];
  try {
    charityEntries = await fetchCharityEvents();
  } catch (err) {
    console.warn('[sitemap] failed to fetch charity events from relays; proceeding with static sitemap only.');
    console.warn(err?.message || err);
  }

  const staticXml = makeUrlset(staticEntries);
  const charitiesXml = makeUrlset(charityEntries);
  const indexXml = makeSitemapIndex([
    { loc: `${SITE_URL}/sitemap-static.xml`, lastmod: now },
    { loc: `${SITE_URL}/sitemap-charities.xml`, lastmod: now }
  ]);

  await writeFile(path.join(PUBLIC_DIR, 'sitemap-static.xml'), staticXml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'sitemap-charities.xml'), charitiesXml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'sitemap.xml'), indexXml, 'utf8');

  console.log(`[sitemap] static urls: ${staticEntries.length}`);
  console.log(`[sitemap] charity urls: ${charityEntries.length}`);
  console.log('[sitemap] wrote public/sitemap.xml + child sitemaps');
}

main().catch((err) => {
  console.error('[sitemap] generation failed');
  console.error(err);
  process.exit(1);
});
