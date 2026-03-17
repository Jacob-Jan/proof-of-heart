import { finalizeEvent } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';

const LOCAL_RELAY = 'ws://127.0.0.1:7777';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * Seeds one deterministic local charity profile into the local test relay.
 * Safe for repeated runs (replaceable kinds with stable d-tag).
 */
export async function seedLocalRelayCharity(): Promise<{ pubkey: string; npubHint: string }> {
  const skHex = '1111111111111111111111111111111111111111111111111111111111111111';
  const sk = hexToBytes(skHex);

  const pool = new SimplePool();
  const now = Math.floor(Date.now() / 1000);

  const kind0 = finalizeEvent({
    kind: 0,
    created_at: now,
    tags: [],
    content: JSON.stringify({
      name: 'E2E Local Charity',
      about: 'Local relay seeded charity for Playwright tests',
      picture: 'https://picsum.photos/120',
      lud16: 'donate@local.test'
    })
  }, sk);

  const kind30078 = finalizeEvent({
    kind: 30078,
    created_at: now,
    tags: [['d', 'proofofheart-charity-profile-v1']],
    content: JSON.stringify({
      shortDescription: 'Seeded for e2e',
      description: 'Local test charity profile used by Playwright E2E',
      country: 'Testland',
      category: 'Education',
      donationMessage: 'Thanks for testing',
      lightningAddress: 'donate@local.test',
      isVisible: true
    })
  }, sk);

  await Promise.any(pool.publish([LOCAL_RELAY], kind0 as any));
  await Promise.any(pool.publish([LOCAL_RELAY], kind30078 as any));

  await new Promise((r) => setTimeout(r, 250));

  return {
    pubkey: kind0.pubkey,
    npubHint: `npub1...${kind0.pubkey.slice(-6)}`
  };
}
