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
  { path: '/partner', changefreq: 'monthly', priority: '0.6' },
  { path: '/charity-list', changefreq: 'daily', priority: '0.8' }
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

const makeCharityListHtml = (records) => {
  const items = records
    .map((c) => `<li><a href="${escapeXml(c.url)}">${escapeXml(c.name)}</a>${c.country ? ` — ${escapeXml(c.country)}` : ''}${c.category ? ` (${escapeXml(c.category)})` : ''}</li>`)
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Proof of Heart Charity List</title>
  <meta name="description" content="Static crawlable list of currently indexed charities on Proof of Heart." />
  <link rel="canonical" href="${SITE_URL}/charity-list" />
</head>
<body>
  <main>
    <h1>Proof of Heart Charity List</h1>
    <p>Static crawlable list generated at build time for crawler and LLM discoverability.</p>
    <p><a href="${SITE_URL}/charities.json">Machine-readable JSON feed</a> · <a href="${SITE_URL}/sitemap-charities.xml">Charity sitemap</a></p>
    <ul>
${items}
    </ul>
  </main>
</body>
</html>
`;
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

async function fetchCharityRecords() {
  const pool = new SimplePool();
  try {
    // Match homepage discovery path exactly: query with #d directly.
    // Generic kind queries can under-return/over-return different replaceable variants.
    const events = await pool.querySync(RELAYS, {
      kinds: [KIND_CHARITY_PROFILE],
      '#d': [D_TAG],
      limit: 800
    });

    const latestByPubkey = new Map();
    for (const event of events) {
      const prev = latestByPubkey.get(event.pubkey);
      if (!prev || (event.created_at || 0) > (prev.created_at || 0)) {
        latestByPubkey.set(event.pubkey, event);
      }
    }

    const records = [];
    for (const event of latestByPubkey.values()) {
      let parsed = {};
      let isVisible = true;
      try {
        parsed = JSON.parse(event.content || '{}');
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

      const profile = parsed || {};
      records.push({
        pubkey: event.pubkey,
        npub,
        url: `${SITE_URL}/charities/${npub}`,
        name: String(profile?.name || '').trim() || `Charity ${npub}`,
        country: String(profile?.country || '').trim() || null,
        category: String(profile?.category || '').trim() || null,
        shortDescription: String(profile?.shortDescription || profile?.description || '').trim() || null,
        image: String(profile?.picture || '').trim() || `${SITE_URL}/assets/logo.png`,
        updatedAt: event.created_at ? new Date(event.created_at * 1000).toISOString() : null,
        updatedDay: toIsoDay(event.created_at)
      });
    }

    records.sort((a, b) => a.url.localeCompare(b.url));
    return records;
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

  let charityRecords = [];
  try {
    charityRecords = await fetchCharityRecords();
  } catch (err) {
    console.warn('[sitemap] failed to fetch charity events from relays; proceeding with static sitemap only.');
    console.warn(err?.message || err);
  }

  const charityEntries = charityRecords.map((c) => ({
    loc: c.url,
    lastmod: c.updatedDay,
    changefreq: 'daily',
    priority: '0.8'
  }));

  const staticXml = makeUrlset(staticEntries);
  const charitiesXml = makeUrlset(charityEntries);
  const indexXml = makeSitemapIndex([
    { loc: `${SITE_URL}/sitemap-static.xml`, lastmod: now },
    { loc: `${SITE_URL}/sitemap-charities.xml`, lastmod: now }
  ]);

  const charityListHtml = makeCharityListHtml(charityRecords);
  const llmsTxt = `# Proof of Heart\n\n> Machine-readable charity data\n\n- Charity JSON feed: ${SITE_URL}/charities.json\n- Charity sitemap: ${SITE_URL}/sitemap-charities.xml\n- Sitemap index: ${SITE_URL}/sitemap.xml\n- Crawlable charity list: ${SITE_URL}/charity-list\n`;

  const llmsFullTxt = [
    '# Proof of Heart Charity Feed (full)',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Feed: ${SITE_URL}/charities.json`,
    `Sitemap: ${SITE_URL}/sitemap-charities.xml`,
    '',
    ...charityRecords.map((c) => `- ${c.name} | ${c.url}`)
  ].join('\n');

  await writeFile(path.join(PUBLIC_DIR, 'sitemap-static.xml'), staticXml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'sitemap-charities.xml'), charitiesXml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'sitemap.xml'), indexXml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'charities.json'), `${JSON.stringify(charityRecords, null, 2)}\n`, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'charity-list.html'), charityListHtml, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'llms.txt'), `${llmsTxt}\n`, 'utf8');
  await writeFile(path.join(PUBLIC_DIR, 'llms-full.txt'), `${llmsFullTxt}\n`, 'utf8');

  console.log(`[sitemap] static urls: ${staticEntries.length}`);
  console.log(`[sitemap] charity urls: ${charityEntries.length}`);
  console.log('[sitemap] wrote public/sitemap.xml + child sitemaps');
  console.log('[sitemap] wrote public/charities.json');
}

main().catch((err) => {
  console.error('[sitemap] generation failed');
  console.error(err);
  process.exit(1);
});
