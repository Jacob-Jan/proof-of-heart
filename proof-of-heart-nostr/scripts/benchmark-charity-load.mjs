import { SimplePool } from 'nostr-tools/pool';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

const KIND_CHARITY_PROFILE = 30078;
const PRIMAL_WS_URL = 'wss://cache2.primal.net/v1';

function nowMs() {
  return Number(process.hrtime.bigint() / 1000000n);
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function queryPrimalFollowerCount(pubkey, timeoutMs = 2500) {
  if (typeof WebSocket === 'undefined') return null;

  return new Promise((resolve) => {
    let settled = false;
    let ws = null;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch {}
      resolve(value);
    };

    const timer = setTimeout(() => finish(null), timeoutMs);

    try {
      ws = new WebSocket(PRIMAL_WS_URL);
    } catch {
      clearTimeout(timer);
      finish(null);
      return;
    }

    ws.onopen = () => {
      try {
        const req = ['REQ', `bench-${pubkey.slice(0, 12)}-${Date.now()}`, { cache: ['user_profile', { pubkey }] }];
        ws?.send(JSON.stringify(req));
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(String(msg.data));
        const candidates = [
          parsed?.followers_count,
          parsed?.followersCount,
          parsed?.user?.followers_count,
          parsed?.user?.followersCount,
          parsed?.profile?.followers_count,
          parsed?.profile?.followersCount,
          parsed?.stats?.followers_count,
          parsed?.stats?.followersCount,
          parsed?.[2]?.followers_count,
          parsed?.[2]?.followersCount,
          parsed?.[2]?.user?.followers_count,
          parsed?.[2]?.user?.followersCount,
        ];

        for (const value of candidates) {
          const n = Number(value);
          if (Number.isFinite(n) && n >= 0) {
            clearTimeout(timer);
            finish(Math.floor(n));
            return;
          }
        }

        if (Array.isArray(parsed) && parsed[0] === 'EOSE') {
          clearTimeout(timer);
          finish(null);
        }
      } catch {}
    };

    ws.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };

    ws.onclose = () => {
      if (!settled) {
        clearTimeout(timer);
        finish(null);
      }
    };
  });
}

async function runSequential(pubkeys) {
  const t0 = nowMs();
  for (const pubkey of pubkeys) {
    await queryPrimalFollowerCount(pubkey, 2500);
  }
  return nowMs() - t0;
}

async function runParallel(pubkeys, concurrency = 12) {
  const t0 = nowMs();
  const queue = [...pubkeys];

  async function worker() {
    while (queue.length) {
      const pubkey = queue.shift();
      if (!pubkey) return;
      await queryPrimalFollowerCount(pubkey, 2500);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, pubkeys.length) }, () => worker()));
  return nowMs() - t0;
}

async function main() {
  const pool = new SimplePool();

  const tFetch0 = nowMs();
  const charityEvents = await pool.querySync(RELAYS, {
    kinds: [KIND_CHARITY_PROFILE],
    '#d': ['proofofheart-charity-profile-v1'],
    limit: 800
  });
  const fetchMs = nowMs() - tFetch0;

  const pubkeys = [...new Set(charityEvents.map((e) => e.pubkey))].slice(0, 36);

  const seqRuns = [];
  const parRuns = [];

  for (let i = 0; i < 3; i++) {
    seqRuns.push(await runSequential(pubkeys));
    parRuns.push(await runParallel(pubkeys, 12));
  }

  console.log(JSON.stringify({
    samplePubkeys: pubkeys.length,
    initialCharityFetchMs: fetchMs,
    sequentialFollowerStageMs: seqRuns,
    sequentialAvgMs: Math.round(avg(seqRuns)),
    parallelFollowerStageMs: parRuns,
    parallelAvgMs: Math.round(avg(parRuns)),
    improvementPercent: Number((((avg(seqRuns) - avg(parRuns)) / avg(seqRuns)) * 100).toFixed(1))
  }, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
