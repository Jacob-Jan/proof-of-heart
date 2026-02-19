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
  zappedSats: number;
  charity: {
    shortDescription?: string;
    description?: string;
    country?: string;
    category?: string;
    donationMessage?: string;
    lightningAddress?: string;
    isVisible?: boolean;
  };
}

export interface CharityExtraFields {
  shortDescription?: string;
  description?: string;
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
const LAST_PUBKEY_KEY = 'poh_last_pubkey';
const ONBOARDED_PUBKEYS_KEY = 'poh_onboarded_pubkeys';

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

  private isLocalhostRuntime(): boolean {
    if (typeof window === 'undefined') return false;
    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
  }

  /**
   * App relay selection (kind 30078/30079 etc.)
   */
  getActiveRelays(): string[] {
    const mode = this.getRelayMode();
    if (mode === 'test') return TEST_RELAYS;
    if (mode === 'prod') return PROD_RELAYS;

    // auto mode: localhost/dev -> test, everything else -> prod
    return this.isLocalhostRuntime() ? TEST_RELAYS : PROD_RELAYS;
  }

  /**
   * Safety guard: on localhost we never publish to production relays.
   */
  private getWriteRelays(): string[] {
    if (this.isLocalhostRuntime()) return TEST_RELAYS;
    return this.getActiveRelays();
  }

  /**
   * kind:0 metadata source: on localhost we still read from prod relays
   * so names/pictures/about resolve from real profiles.
   */
  private getKind0ReadRelays(): string[] {
    if (this.isLocalhostRuntime()) return PROD_RELAYS;
    return this.getActiveRelays();
  }

  async connectSigner(): Promise<{ pubkey: string; npub: string }> {
    if (!window.nostr) throw new Error('No Nostr signer found (install a NIP-07 extension).');
    const pubkey = await window.nostr.getPublicKey();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LAST_PUBKEY_KEY, pubkey);
    }
    const npub = nip19.npubEncode(pubkey);
    return { pubkey, npub };
  }

  async loadKind0Profile(pubkey: string): Promise<Record<string, any>> {
    const relays = this.getKind0ReadRelays();
    const events = await this.pool.querySync(relays, {
      kinds: [0],
      authors: [pubkey],
      limit: 20
    });

    if (!events.length) return {};

    const sorted = [...events].sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0));
    const merged: Record<string, any> = {};

    for (const ev of sorted as any[]) {
      const data = this.safeJson(ev.content || '{}');
      for (const key of ['name', 'display_name', 'displayName', 'username', 'about', 'picture', 'website', 'lud16', 'lud06']) {
        if ((merged[key] === undefined || merged[key] === null || merged[key] === '') && data[key] !== undefined && data[key] !== null && data[key] !== '') {
          merged[key] = data[key];
        }
      }
    }

    return merged;
  }

  async getCurrentPubkey(): Promise<string> {
    try {
      if (window.nostr) {
        const pubkey = await window.nostr.getPublicKey();
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(LAST_PUBKEY_KEY, pubkey);
        }
        return pubkey;
      }
    } catch {
      // fall back to cached pubkey
    }

    if (typeof window !== 'undefined') {
      return window.localStorage.getItem(LAST_PUBKEY_KEY) || '';
    }

    return '';
  }

  hasLocalOnboarding(pubkey: string): boolean {
    if (typeof window === 'undefined' || !pubkey) return false;
    try {
      const raw = window.localStorage.getItem(ONBOARDED_PUBKEYS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) && arr.includes(pubkey);
    } catch {
      return false;
    }
  }

  markLocalOnboarding(pubkey: string): void {
    if (typeof window === 'undefined' || !pubkey) return;
    try {
      const raw = window.localStorage.getItem(ONBOARDED_PUBKEYS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(arr) ? arr.filter((v: any) => typeof v === 'string') : [];
      if (!next.includes(pubkey)) next.push(pubkey);
      window.localStorage.setItem(ONBOARDED_PUBKEYS_KEY, JSON.stringify(next));
    } catch {
      window.localStorage.setItem(ONBOARDED_PUBKEYS_KEY, JSON.stringify([pubkey]));
    }
  }

  disconnectCurrentSession(pubkey: string): void {
    if (typeof window === 'undefined') return;

    try {
      const raw = window.localStorage.getItem(ONBOARDED_PUBKEYS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      const next = Array.isArray(arr)
        ? arr.filter((v: any) => typeof v === 'string' && v !== pubkey)
        : [];
      window.localStorage.setItem(ONBOARDED_PUBKEYS_KEY, JSON.stringify(next));
    } catch {
      window.localStorage.setItem(ONBOARDED_PUBKEYS_KEY, JSON.stringify([]));
    }

    const lastPubkey = window.localStorage.getItem(LAST_PUBKEY_KEY);
    if (!pubkey || lastPubkey === pubkey) {
      window.localStorage.removeItem(LAST_PUBKEY_KEY);
    }
  }

  async publishCharityProfile(fields: CharityExtraFields): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getWriteRelays();

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

  async loadOwnCharityProfile(pubkey: string): Promise<CharityExtraFields | null> {
    const relays = this.getActiveRelays();
    const events = await this.pool.querySync(relays, {
      kinds: [KIND_CHARITY_PROFILE],
      authors: [pubkey],
      '#d': ['proofofheart-charity-profile-v1'],
      limit: 20
    });

    if (!events.length) return null;

    const latest = [...events].sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0))[0] as any;
    return this.safeJson(latest.content || '{}') as CharityExtraFields;
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
      shortDescription: '',
      description: '',
      country: '',
      category: '',
      donationMessage: '',
      lightningAddress: '',
      isVisible: true
    });
  }

  async publishRating(targetPubkey: string, rating: number, note = ''): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getWriteRelays();
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
    const relays = this.getWriteRelays();

    const event = {
      kind: KIND_REPORT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', targetPubkey, reason],
        ['d', `report:${targetPubkey}`],
        ['report_state', '1']
      ],
      content: note || `Report reason: ${reason}`
    };

    const signed = await window.nostr.signEvent(event);
    await Promise.any(this.pool.publish(relays, signed as any));
    return signed.id;
  }

  async publishUnreport(targetPubkey: string): Promise<string> {
    if (!window.nostr) throw new Error('No Nostr signer found.');
    const relays = this.getWriteRelays();

    const event = {
      kind: KIND_REPORT,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['p', targetPubkey],
        ['d', `report:${targetPubkey}`],
        ['report_state', '0']
      ],
      content: 'Report withdrawn'
    };

    const signed = await window.nostr.signEvent(event);
    await Promise.any(this.pool.publish(relays, signed as any));
    return signed.id;
  }

  async hasUserFlagged(targetPubkey: string, reporterPubkey: string): Promise<boolean> {
    if (!targetPubkey || !reporterPubkey) return false;
    const relays = this.getActiveRelays();
    const reports = await this.pool.querySync(relays, {
      kinds: [KIND_REPORT],
      authors: [reporterPubkey],
      '#p': [targetPubkey],
      limit: 200
    });

    const latest = [...reports]
      .sort((a: any, b: any) => (b.created_at || 0) - (a.created_at || 0))[0] as any;

    if (!latest) return false;

    const stateTag = latest.tags?.find((t: string[]) => t[0] === 'report_state')?.[1];
    if (stateTag === '0') return false;
    if (stateTag === '1') return true;

    return true;
  }

  async loadCharities(limit = 100): Promise<CharityProfile[]> {
    const appRelays = this.getActiveRelays();
    const kind0Relays = this.getKind0ReadRelays();

    const charityEvents = await this.pool.querySync(appRelays, {
      kinds: [KIND_CHARITY_PROFILE],
      '#d': ['proofofheart-charity-profile-v1'],
      limit: limit * 4
    });

    const pubkeys = [...new Set(charityEvents.map((e: any) => e.pubkey))];
    if (!pubkeys.length) return [];

    const profileEvents = await this.pool.querySync(kind0Relays, {
      kinds: [0],
      authors: pubkeys,
      limit: Math.max(limit * 4, pubkeys.length * 4)
    });

    const [reports, ratings, followers, zapReceipts] = await Promise.all([
      this.pool.querySync(appRelays, {
        kinds: [KIND_REPORT],
        '#p': pubkeys,
        limit: limit * 10
      }),
      this.pool.querySync(appRelays, {
        kinds: [KIND_CHARITY_RATING],
        '#p': pubkeys,
        limit: limit * 10
      }),
      this.pool.querySync(kind0Relays, {
        kinds: [3],
        '#p': pubkeys,
        limit: limit * 50
      }),
      this.pool.querySync(appRelays, {
        kinds: [9735],
        '#p': pubkeys,
        limit: limit * 100
      })
    ]);

    const metadataByPubkey = new Map<string, any>();
    const profileEventsByPubkey = new Map<string, any[]>();
    for (const ev of profileEvents as any[]) {
      const key = ev.pubkey;
      const arr = profileEventsByPubkey.get(key) ?? [];
      arr.push(ev);
      profileEventsByPubkey.set(key, arr);
    }

    for (const [pubkey, events] of profileEventsByPubkey.entries()) {
      const sorted = [...events].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
      const merged: any = {};
      for (const ev of sorted) {
        const data = this.safeJson(ev.content || '{}');
        for (const key of ['name', 'display_name', 'displayName', 'username', 'about', 'picture', 'website', 'lud16', 'lud06']) {
          if ((merged[key] === undefined || merged[key] === null || merged[key] === '') && data[key] !== undefined && data[key] !== null && data[key] !== '') {
            merged[key] = data[key];
          }
        }
      }
      metadataByPubkey.set(pubkey, merged);
    }

    const latestCharity = new Map<string, any>();
    for (const ev of charityEvents) {
      const prev = latestCharity.get((ev as any).pubkey);
      if (!prev || (ev as any).created_at > prev.created_at) latestCharity.set((ev as any).pubkey, ev);
    }

    const latestReportByReporterAndTarget = new Map<string, any>();
    for (const ev of reports as any[]) {
      const p = ev.tags.find((t: string[]) => t[0] === 'p')?.[1];
      if (!p) continue;
      const key = `${ev.pubkey}:${p}`;
      const prev = latestReportByReporterAndTarget.get(key);
      if (!prev || (ev.created_at || 0) > (prev.created_at || 0)) {
        latestReportByReporterAndTarget.set(key, ev);
      }
    }

    const flagMap = new Map<string, Set<string>>();
    for (const ev of latestReportByReporterAndTarget.values()) {
      const p = ev.tags.find((t: string[]) => t[0] === 'p')?.[1];
      if (!p) continue;
      const stateTag = ev.tags.find((t: string[]) => t[0] === 'report_state')?.[1];
      const isFlagged = stateTag === '0' ? false : true;
      if (!isFlagged) continue;
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

    const zapMap = new Map<string, number>();
    for (const ev of zapReceipts as any[]) {
      const p = ev.tags.find((t: string[]) => t[0] === 'p')?.[1];
      const amountMsat = Number(ev.tags.find((t: string[]) => t[0] === 'amount')?.[1] || 0);
      if (!p || Number.isNaN(amountMsat) || amountMsat <= 0) continue;
      const sats = Math.floor(amountMsat / 1000);
      zapMap.set(p, (zapMap.get(p) || 0) + sats);
    }

    const charities: CharityProfile[] = [];

    for (const [pubkey, charityEvent] of latestCharity.entries()) {
      const metadata = metadataByPubkey.get(pubkey) || {};
      const extra = this.safeJson(charityEvent.content) as CharityExtraFields;
      const flags = flagMap.get(pubkey)?.size ?? 0;
      const rating = ratingMap.get(pubkey) ?? { total: 0, count: 0 };

      const resolvedName = [
        metadata?.display_name,
        metadata?.displayName,
        metadata?.name,
        metadata?.username
      ].find((v: any) => typeof v === 'string' && v.trim().length > 0);

      charities.push({
        pubkey,
        npub: nip19.npubEncode(pubkey),
        name: resolvedName?.trim() || `Charity ${nip19.npubEncode(pubkey).slice(0, 14)}…`,
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
        zappedSats: zapMap.get(pubkey) || 0,
        charity: {
          shortDescription: extra?.shortDescription,
          description: extra?.description,
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


