// Proof of Heart LNURL proxy worker
// Deploy on Cloudflare Workers and call from frontend when direct LNURL callback fetch fails (CORS).

const ALLOWED_HOSTS = new Set([
  'next.proofofheart.org',
  'proofofheart.org',
  'localhost:4200'
]);

const CHARITIES_CACHE_URL = 'https://worker.internal/cache/charities';
const CHARITIES_SNAPSHOT_URL = 'https://worker.internal/cache/charities-snapshot';
const CACHE_CONTROL_SWR = 'public, max-age=60, stale-while-revalidate=300';

function corsHeaders(origin) {
  const allowOrigin = origin && ALLOWED_HOSTS.has(new URL(origin).host) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders
    }
  });
}

function badRequest(msg, headers = {}) {
  return json({ status: 'ERROR', reason: msg }, 400, headers);
}

function isSafeHostname(hostname) {
  if (!hostname) return false;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
  return /^[a-z0-9.-]+$/i.test(hostname);
}

function parseSources(env) {
  const raw = env?.CHARITY_AGGREGATION_SOURCES || '';
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.filter((value) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  });
}

function normalizeCharities(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.charities)) return payload.charities;
  if (Array.isArray(payload?.items)) return payload.items;
  return [];
}

async function fetchJson(url) {
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json'
    }
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Upstream did not return JSON (status ${res.status})`);
  }

  if (!res.ok) {
    throw new Error(`Upstream error (${res.status}): ${data?.reason || res.statusText}`);
  }

  return data;
}

async function aggregateCharities(env) {
  const sources = parseSources(env);
  if (!sources.length) {
    throw new Error('CHARITY_AGGREGATION_SOURCES is not configured');
  }

  const responses = await Promise.allSettled(
    sources.map((source) => fetchJson(source))
  );

  const merged = [];
  const seen = new Set();

  for (const response of responses) {
    if (response.status !== 'fulfilled') continue;
    const rows = normalizeCharities(response.value);
    for (const item of rows) {
      const key = String(item?.pubkey || item?.npub || item?.id || '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  if (!merged.length) {
    throw new Error('No charities returned by aggregation sources');
  }

  return {
    charities: merged,
    fetchedAt: new Date().toISOString(),
    sourceCount: sources.length
  };
}

function withCacheHeaders(headers, cacheStatus) {
  return {
    ...headers,
    'Cache-Control': CACHE_CONTROL_SWR,
    'X-Cache-Status': cacheStatus
  };
}

async function getCharitiesResponse(request, env, ctx, cors) {
  const cache = caches.default;
  const cacheKey = new Request(CHARITIES_CACHE_URL);
  const snapshotKey = new Request(CHARITIES_SNAPSHOT_URL);

  const cached = await cache.match(cacheKey);
  if (cached) {
    const revalidate = async () => {
      try {
        const fresh = await aggregateCharities(env);
        const freshRes = json(fresh, 200, withCacheHeaders(cors, 'REFRESHED'));
        await cache.put(cacheKey, freshRes.clone());
        await cache.put(snapshotKey, freshRes.clone());
      } catch {
        // keep stale cache and snapshot
      }
    };

    ctx.waitUntil(revalidate());

    const body = await cached.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...withCacheHeaders(cors, 'HIT')
      }
    });
  }

  try {
    const fresh = await aggregateCharities(env);
    const freshRes = json(fresh, 200, withCacheHeaders(cors, 'MISS'));
    ctx.waitUntil(cache.put(cacheKey, freshRes.clone()));
    ctx.waitUntil(cache.put(snapshotKey, freshRes.clone()));
    return freshRes;
  } catch (error) {
    const snapshot = await cache.match(snapshotKey);
    if (snapshot) {
      const body = await snapshot.text();
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          ...withCacheHeaders(cors, 'SNAPSHOT')
        }
      });
    }

    return json(
      { status: 'ERROR', reason: error instanceof Error ? error.message : 'Failed to load charities' },
      502,
      cors
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const c = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c });
    }

    if (request.method !== 'GET') {
      return json({ status: 'ERROR', reason: 'Method not allowed' }, 405, c);
    }

    const url = new URL(request.url);

    // GET /api/charities
    if (url.pathname === '/api/charities') {
      return getCharitiesResponse(request, env, ctx, c);
    }

    // GET /lnurlp?address=name@domain.tld
    if (url.pathname === '/lnurlp') {
      const address = (url.searchParams.get('address') || '').trim().toLowerCase();
      if (!address || !address.includes('@')) {
        return badRequest('address query param must be a valid lightning address', c);
      }

      const [name, domain] = address.split('@');
      if (!name || !domain || !isSafeHostname(domain)) {
        return badRequest('invalid lightning address', c);
      }

      try {
        const upstream = new URL(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`);
        const data = await fetchJson(upstream);
        return json(data, 200, c);
      } catch (err) {
        return json({ status: 'ERROR', reason: err instanceof Error ? err.message : 'Failed to fetch LNURL pay params' }, 502, c);
      }
    }

    // GET /callback?callback=<url>&amount=...&nostr=...&comment=...
    if (url.pathname === '/callback') {
      const callbackRaw = url.searchParams.get('callback') || '';
      if (!callbackRaw) return badRequest('missing callback query param', c);

      let callback;
      try {
        callback = new URL(callbackRaw);
      } catch {
        return badRequest('invalid callback URL', c);
      }

      if (callback.protocol !== 'https:') {
        return badRequest('callback URL must use https', c);
      }

      const amount = url.searchParams.get('amount');
      if (!amount) return badRequest('missing amount query param', c);
      callback.searchParams.set('amount', amount);

      const nostr = url.searchParams.get('nostr');
      if (nostr) callback.searchParams.set('nostr', nostr);

      const comment = url.searchParams.get('comment');
      if (comment) callback.searchParams.set('comment', comment);

      try {
        const data = await fetchJson(callback);
        return json(data, 200, c);
      } catch (err) {
        return json({ status: 'ERROR', reason: err instanceof Error ? err.message : 'Failed to fetch LNURL callback' }, 502, c);
      }
    }

    return json({
      ok: true,
      endpoints: {
        charities: '/api/charities',
        lnurlp: '/lnurlp?address=name@domain.tld',
        callback: '/callback?callback=https://...&amount=1000[&nostr=JSON]'
      }
    }, 200, c);
  }
};
