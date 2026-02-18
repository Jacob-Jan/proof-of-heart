import { Injectable } from '@angular/core';
import { SimplePool } from 'nostr-tools/pool';
import { nip19 } from 'nostr-tools';

export interface CharityProfile {
  pubkey: string;
  npub: string;
  name: string;
  about: string;
  picture?: string;
  website?: string;
  lud16?: string;
  lud06?: string;
  followers: number;
  flags: number;
  hidden: boolean;
  ratingAvg: number;
  ratingCount: number;
  charity: {
    mission?: string;
    country?: string;
    category?: string;
    donationMessage?: string;
    lightningAddress?: string;
    isVisible?: boolean;
  };
}

export interface CharityExtraFields {
  mission?: string;
  country?: string;
  category?: string;
  donationMessage?: string;
  lightningAddress?: string;
  isVisible?: boolean;
}

const PROD_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

const TEST_RELAYS = [
  'ws://127.0.0.1:7777'
];

const RELAY_MODE_KEY = 'poh_relay_mode'; // auto | test | prod

const KIND_CHARITY_PROFILE = 30078; // app-specific parameterized replaceable
const KIND_CHARITY_RATING = 30079; // app-specific parameterized replaceable
const KIND_REPORT = 1984; // NIP-56 report
const FLAG_HIDE_THRESHOLD = 3;

@Injectable({ providedIn: 'root' })
export class NostrService {
  private pool = new SimplePool();

  async hasSigner(): Promise<boolean> {
    return typeof window !== 'undefined' && !!window.nostr;
  }

  getRelayMode(): 'auto' | 'test' | 'prod' {
    if (typeof window === 'undefined') return 'prod';
    const saved = window.localStorage.getItem(RELAY_MODE_KEY);
    if (saved === 'test' || saved === 'prod' || saved === 'auto') return saved;
    return 'auto';
  }

  setRelayMode(mode: 'auto' | 'test' | 'prod') {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(RELAY_MODE_KEY, mode);
  }

  getActiveRelays(): string[] {
    const mode = this.getRelayMode();
    if (mode === 'test') return TEST_RELAYS;
    if (mode === 'prod') return PROD_RELAYS;

    // auto mode: localhost/dev -> test, everything else -> prod
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      const isLocal = host === 'localhost' || host === '127.0.0.1';
      return isLocal ? TEST_RELAYS : PROD_RELAYS;
    }

    return PROD_RELAYS;
  }

  async connectSigner(): Promise<{ pubkey: string; npub: string }> {
    if (!window.nostr) throw new Error('No Nostr signer found (install a NIP-07 extension).');
    const pubkey = await window.nostr.getPublicKey();
    const npub = nip19.npubEncode(pubkey);
    return { pubkey, npub };
  }

  async publishCharityProfile(fields: CharityExtraFields): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getActiveRelays();

    const event = {
      kind: KIND_CHARITY_PROFILE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'proofofheart-charity-profile-v1']],
      content: JSON.stringify(fields)
    };

    const signed = await window.nostr.signEvent(event);
    await Promise.any(this.pool.publish(relays, signed as any));
    return signed.id;
  }

  async ensureCharityProfile(pubkey: string): Promise<void> {
    const relays = this.getActiveRelays();
    const existing = await this.pool.querySync(relays, {
      kinds: [KIND_CHARITY_PROFILE],
      authors: [pubkey],
      '#d': ['proofofheart-charity-profile-v1'],
      limit: 1
    });

    if (existing.length > 0) return;

    await this.publishCharityProfile({
      mission: '',
      country: '',
      category: '',
      donationMessage: '',
      lightningAddress: '',
      isVisible: true
    });
  }

  async publishRating(targetPubkey: string, rating: number, note = ''): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getActiveRelays();
    const cleanRating = Math.max(1, Math.min(5, Math.round(rating)));

    const event = {
      kind: KIND_CHARITY_RATING,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', targetPubkey],
        ['d', `rating:${targetPubkey}`],
        ['rating', String(cleanRating)]
      ],
      content: note
    };

    const signed = await window.nostr.signEvent(event);
    await Promise.any(this.pool.publish(relays, signed as any));
    return signed.id;
  }

  async publishReport(targetPubkey: string, reason: 'spam' | 'impersonation' | 'scam', note = ''): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getActiveRelays();

    const event = {
      kind: KIND_REPORT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', targetPubkey, reason]],
      content: note || `Report reason: ${reason}`
    };

    const signed = await window.nostr.signEvent(event);
    await Promise.any(this.pool.publish(relays, signed as any));
    return signed.id;
  }

  async loadCharities(limit = 100): Promise<CharityProfile[]> {
    const relays = this.getActiveRelays();

    const profileEvents = await this.pool.querySync(relays, {
      kinds: [0],
      limit
    });

    const pubkeys = [...new Set(profileEvents.map((e: any) => e.pubkey))];
    if (!pubkeys.length) return [];

    const [charityEvents, reports, ratings, followers] = await Promise.all([
      this.pool.querySync(relays, {
        kinds: [KIND_CHARITY_PROFILE],
        '#d': ['proofofheart-charity-profile-v1'],
        authors: pubkeys,
        limit: limit * 2
      }),
      this.pool.querySync(relays, {
        kinds: [KIND_REPORT],
        '#p': pubkeys,
        limit: limit * 10
      }),
      this.pool.querySync(relays, {
        kinds: [KIND_CHARITY_RATING],
        '#p': pubkeys,
        limit: limit * 10
      }),
      this.pool.querySync(relays, {
        kinds: [3],
        '#p': pubkeys,
        limit: limit * 50
      })
    ]);

    const latestMeta = new Map<string, any>();
    for (const ev of profileEvents) {
      const prev = latestMeta.get((ev as any).pubkey);
      if (!prev || (ev as any).created_at > prev.created_at) latestMeta.set((ev as any).pubkey, ev);
    }

    const latestCharity = new Map<string, any>();
    for (const ev of charityEvents) {
      const prev = latestCharity.get((ev as any).pubkey);
      if (!prev || (ev as any).created_at > prev.created_at) latestCharity.set((ev as any).pubkey, ev);
    }

    const flagMap = new Map<string, Set<string>>();
    for (const ev of reports as any[]) {
      const p = ev.tags.find((t: string[]) => t[0] === 'p')?.[1];
      if (!p) continue;
      if (!flagMap.has(p)) flagMap.set(p, new Set());
      flagMap.get(p)!.add(ev.pubkey);
    }

    const followerMap = new Map<string, Set<string>>();
    for (const ev of followers as any[]) {
      const targetTags = ev.tags.filter((t: string[]) => t[0] === 'p' && pubkeys.includes(t[1]));
      for (const [, target] of targetTags) {
        if (!followerMap.has(target)) followerMap.set(target, new Set());
        followerMap.get(target)!.add(ev.pubkey);
      }
    }

    const ratingMap = new Map<string, { total: number; count: number }>();
    for (const ev of ratings as any[]) {
      const p = ev.tags.find((t: string[]) => t[0] === 'p')?.[1];
      const r = Number(ev.tags.find((t: string[]) => t[0] === 'rating')?.[1]);
      if (!p || Number.isNaN(r) || r < 1 || r > 5) continue;
      const current = ratingMap.get(p) ?? { total: 0, count: 0 };
      current.total += r;
      current.count += 1;
      ratingMap.set(p, current);
    }

    const charities: CharityProfile[] = [];

    for (const [pubkey, metaEvent] of latestMeta.entries()) {
      const charityEvent = latestCharity.get(pubkey);
      if (!charityEvent) continue;

      const metadata = this.safeJson(metaEvent.content);
      const extra = this.safeJson(charityEvent.content) as CharityExtraFields;
      const flags = flagMap.get(pubkey)?.size ?? 0;
      const rating = ratingMap.get(pubkey) ?? { total: 0, count: 0 };

      charities.push({
        pubkey,
        npub: nip19.npubEncode(pubkey),
        name: metadata?.name || metadata?.display_name || 'Unnamed charity',
        about: metadata?.about || '',
        picture: metadata?.picture,
        website: metadata?.website,
        lud16: metadata?.lud16,
        lud06: metadata?.lud06,
        followers: followerMap.get(pubkey)?.size ?? 0,
        flags,
        hidden: flags >= FLAG_HIDE_THRESHOLD,
        ratingAvg: rating.count ? rating.total / rating.count : 0,
        ratingCount: rating.count,
        charity: {
          mission: extra?.mission,
          country: extra?.country,
          category: extra?.category,
          donationMessage: extra?.donationMessage,
          lightningAddress: extra?.lightningAddress,
          isVisible: extra?.isVisible ?? true
        }
      });
    }

    return charities.sort((a, b) => {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;
      if (b.followers !== a.followers) return b.followers - a.followers;
      return b.ratingAvg - a.ratingAvg;
    });
  }

  private safeJson(content: string): any {
    try {
      return JSON.parse(content || '{}');
    } catch {
      return {};
    }
  }
}
