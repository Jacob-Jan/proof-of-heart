// Proof of Heart LNURL proxy worker
// Deploy on Cloudflare Workers and call from frontend when direct LNURL callback fetch fails (CORS).

const ALLOWED_HOSTS = new Set([
  'next.proofofheart.org',
  'proofofheart.org',
  'localhost:4200'
]);

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

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const c = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: c });
    }

    if (request.method !== 'GET') {
      return json({ status: 'ERROR', reason: 'Method not allowed' }, 405, c);
    }

    const url = new URL(request.url);

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
        lnurlp: '/lnurlp?address=name@domain.tld',
        callback: '/callback?callback=https://...&amount=1000[&nostr=JSON]'
      }
    }, 200, c);
  }
};
