import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
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
  followersLoaded?: boolean;
  flags: number;
  hidden: boolean;
  ratingAvg: number;
  ratingCount: number;
  zappedSats: number;
  profileUpdatedAt?: number;
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

export interface CharityLoadResult {
  charities: CharityProfile[];
  fromCache: boolean;
}

export interface CharityFeedStatus {
  tone: 'relay' | 'cache' | 'success' | 'warning';
  label: string;
  text: string;
}

function isProofOfHeartCharity(charity: CharityProfile): boolean {
  const normalizedName = (charity?.name || '').trim().toLowerCase();
  return normalizedName === 'proof of heart' || normalizedName.includes('proof of heart');
}

function compareCharityProfiles(a: CharityProfile, b: CharityProfile): number {
  const aProofOfHeart = isProofOfHeartCharity(a);
  const bProofOfHeart = isProofOfHeartCharity(b);
  if (aProofOfHeart !== bProofOfHeart) return aProofOfHeart ? 1 : -1;

  if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;

  const aUpdatedAt = Number.isFinite(a.profileUpdatedAt) ? (a.profileUpdatedAt as number) : 0;
  const bUpdatedAt = Number.isFinite(b.profileUpdatedAt) ? (b.profileUpdatedAt as number) : 0;
  if (bUpdatedAt !== aUpdatedAt) return bUpdatedAt - aUpdatedAt;

  // Keep ties stable in their existing cache/relay order instead of
  // re-sorting alphabetically, so the list feels consistent across refreshes.
  return 0;
}

export function sortCharityProfiles(charities: CharityProfile[]): CharityProfile[] {
  return [...charities].sort(compareCharityProfiles);
}

export function mergeCharityProfiles(existing: CharityProfile[], incoming: CharityProfile[]): CharityProfile[] {
  const existingByPubkey = new Map(existing.map((charity) => [charity.pubkey, charity] as const));

  return incoming.map((fresh) => {
    const cached = existingByPubkey.get(fresh.pubkey);
    if (!cached) return fresh;

    return {
      ...cached,
      ...fresh,
      about: fresh.about ?? cached.about,
      picture: fresh.picture ?? cached.picture,
      website: fresh.website ?? cached.website,
      lud16: fresh.lud16 ?? cached.lud16,
      lud06: fresh.lud06 ?? cached.lud06,
      followers: fresh.followersLoaded ? fresh.followers : cached.followers,
      followersLoaded: fresh.followersLoaded || cached.followersLoaded,
      flags: Number.isFinite(fresh.flags) ? fresh.flags : cached.flags,
      hidden: typeof fresh.hidden === 'boolean' ? fresh.hidden : cached.hidden,
      ratingAvg: Number.isFinite(fresh.ratingAvg) ? fresh.ratingAvg : cached.ratingAvg,
      ratingCount: Number.isFinite(fresh.ratingCount) ? fresh.ratingCount : cached.ratingCount,
      zappedSats: Number.isFinite(fresh.zappedSats) ? fresh.zappedSats : cached.zappedSats,
      charity: {
        ...cached.charity,
        ...fresh.charity,
        shortDescription: fresh.charity?.shortDescription ?? cached.charity.shortDescription,
        description: fresh.charity?.description ?? cached.charity.description,
        country: fresh.charity?.country ?? cached.charity.country,
        category: fresh.charity?.category ?? cached.charity.category,
        donationMessage: fresh.charity?.donationMessage ?? cached.charity.donationMessage,
        lightningAddress: fresh.charity?.lightningAddress ?? cached.charity.lightningAddress,
        isVisible: typeof fresh.charity?.isVisible === 'boolean' ? fresh.charity.isVisible : cached.charity.isVisible
      }
    };
  });
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
const PRIMAL_WS_URL = 'wss://cache2.primal.net/v1';
const FOLLOWERS_CACHE_KEY = 'poh_followers_cache_v1';
const FOLLOWERS_CACHE_TTL_MS = 10 * 60 * 1000;
const CHARITIES_CACHE_KEY = 'poh_charities_cache_v2';
const CHARITIES_CACHE_VERSION = 2;
const CHARITIES_CACHE_TTL_HOME_MS = 30 * 60 * 1000;
const CHARITIES_CACHE_TTL_DETAIL_MS = 10 * 60 * 1000;
const CHARITY_DETAIL_CACHE_PREFIX = 'poh_charity_detail_cache_v1:';

const KIND_CHARITY_PROFILE = 30078; // app-specific parameterized replaceable
const KIND_CHARITY_RATING = 30079; // app-specific parameterized replaceable
const KIND_REPORT = 1984; // NIP-56 report
const FLAG_HIDE_THRESHOLD = 3;

@Injectable({ providedIn: 'root' })
export class NostrService {
  private pool = new SimplePool();
  private charityRefreshInFlight?: Promise<void>;
  private charityFeedStatusSubject = new BehaviorSubject<CharityFeedStatus | null>(null);
  readonly charityFeedStatus$ = this.charityFeedStatusSubject.asObservable();

  setCharityFeedStatus(tone: CharityFeedStatus['tone'], text: string): void {
    const label = tone === 'cache' ? 'Cache' : tone === 'success' ? 'Live' : tone === 'warning' ? 'Relay issue' : 'Loading';
    this.charityFeedStatusSubject.next({ tone, label, text });
  }

  clearCharityFeedStatus(): void {
    this.charityFeedStatusSubject.next(null);
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

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

    // auto mode defaults to production relays.
    // Use explicit "test" mode when running a local relay on 127.0.0.1:7777.
    return PROD_RELAYS;
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
    // IMPORTANT: do not call window.nostr.getPublicKey() here.
    // Some signers show a permission/sign-in prompt when accessed,
    // and this method is used during route navigation.
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

    const localPubkey = typeof window !== 'undefined'
      ? (window.localStorage.getItem(LAST_PUBKEY_KEY) || undefined)
      : undefined;

    const event = {
      kind: KIND_CHARITY_PROFILE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'proofofheart-charity-profile-v1']],
      content: JSON.stringify(fields),
      ...(localPubkey ? { pubkey: localPubkey } : {})
    };

    console.info('[PoH] publishCharityProfile:start', {
      relays,
      event,
      userActivationActive: (navigator as any)?.userActivation?.isActive ?? null
    });

    let signed: any;
    try {
      signed = await this.withTimeout(
        window.nostr.signEvent(event),
        60_000,
        'Signer response'
      );
      console.info('[PoH] publishCharityProfile:signed', { id: signed?.id, pubkey: signed?.pubkey });
    } catch (e: any) {
      console.error('[PoH] publishCharityProfile:sign-failed', e);
      throw new Error(`Signer could not sign charity profile event. ${e?.message || ''}`.trim());
    }

    try {
      await this.withTimeout(
        Promise.any(this.pool.publish(relays, signed as any)),
        15_000,
        'Relay publish acknowledgement'
      );
      console.info('[PoH] publishCharityProfile:publish-accepted', { id: signed.id, relays });
    } catch (e: any) {
      console.error('[PoH] publishCharityProfile:publish-failed', e);
      throw new Error('Signed profile event, but relays did not accept it. Try another relay/signer and retry.');
    }

    // Read-after-write verification to surface signer/relay issues explicitly.
    const verifyStart = Date.now();
    while (Date.now() - verifyStart < 10_000) {
      try {
        const found = await this.pool.querySync(relays, {
          kinds: [KIND_CHARITY_PROFILE],
          authors: [signed.pubkey],
          '#d': ['proofofheart-charity-profile-v1'],
          limit: 1
        });

        if (found.length > 0) {
          console.info('[PoH] publishCharityProfile:verified', { id: signed.id });
          return signed.id;
        }
      } catch (e) {
        console.warn('[PoH] publishCharityProfile:verify-query-failed', e);
      }

      await new Promise(resolve => setTimeout(resolve, 700));
    }

    console.error('[PoH] publishCharityProfile:not-visible-after-timeout', { id: signed.id, relays });
    throw new Error('Profile was signed, but not visible on app relays yet. Please retry in a few seconds or switch signer.');
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

  private readFollowerCache(): Record<string, { value: number; ts: number }> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(FOLLOWERS_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  private writeFollowerCache(cache: Record<string, { value: number; ts: number }>): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(FOLLOWERS_CACHE_KEY, JSON.stringify(cache));
    } catch {
      // ignore quota / storage errors
    }
  }

  private readCachedFollowerCounts(pubkeys: string[], maxAgeMs = FOLLOWERS_CACHE_TTL_MS): Map<string, number> {
    const now = Date.now();
    const cache = this.readFollowerCache();
    const result = new Map<string, number>();

    for (const pubkey of pubkeys) {
      const cached = cache[pubkey];
      if (cached && Number.isFinite(cached.value) && (now - cached.ts) < maxAgeMs) {
        result.set(pubkey, Math.max(0, Math.floor(cached.value)));
      }
    }

    return result;
  }

  private hydrateCachedFollowerCounts(charities: CharityProfile[], persist = false): CharityProfile[] {
    if (typeof window === 'undefined' || !charities.length) return charities;

    const followerCounts = this.readCachedFollowerCounts(charities.map((charity) => charity.pubkey));
    if (!followerCounts.size) return charities;

    let changed = false;
    const hydrated = charities.map((charity) => {
      const cachedFollowers = followerCounts.get(charity.pubkey);
      if (cachedFollowers === undefined) return charity;
      changed = true;
      return { ...charity, followers: cachedFollowers, followersLoaded: true };
    });

    if (changed && persist) {
      this.writeCharityCache(hydrated);
    }

    return hydrated;
  }

  private readCharityCache(limit = 100, maxAgeMs = CHARITIES_CACHE_TTL_HOME_MS): CharityProfile[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(CHARITIES_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (parsed?.v !== CHARITIES_CACHE_VERSION) {
        window.localStorage.removeItem(CHARITIES_CACHE_KEY);
        return [];
      }
      const ts = Number(parsed?.ts);
      if (!Number.isFinite(ts) || Date.now() - ts > maxAgeMs) {
        window.localStorage.removeItem(CHARITIES_CACHE_KEY);
        return [];
      }
      const records = Array.isArray(parsed?.charities) ? parsed.charities : [];
      const charities = sortCharityProfiles(records
        .map((record: any) => this.coerceCachedCharity(record))
        .filter((value: CharityProfile | null): value is CharityProfile => !!value)
        .slice(0, limit));
      return this.hydrateCachedFollowerCounts(charities, true);
    } catch {
      try {
        window.localStorage.removeItem(CHARITIES_CACHE_KEY);
      } catch {
        // ignore storage errors
      }
      return [];
    }
  }

  private readStoredCharityCache(limit = 100): CharityProfile[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(CHARITIES_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (parsed?.v !== CHARITIES_CACHE_VERSION) return [];
      const records = Array.isArray(parsed?.charities) ? parsed.charities : [];
      return sortCharityProfiles(records
        .map((record: any) => this.coerceCachedCharity(record))
        .filter((value: CharityProfile | null): value is CharityProfile => !!value)
        .slice(0, limit));
    } catch {
      return [];
    }
  }

  private writeCharityCache(charities: CharityProfile[]): void {
    if (typeof window === 'undefined') return;
    try {
      const merged = mergeCharityProfiles(this.readStoredCharityCache(Math.max(charities.length, 100)), charities);
      const payload = { v: CHARITIES_CACHE_VERSION, ts: Date.now(), charities: merged };
      window.localStorage.setItem(CHARITIES_CACHE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota / storage errors
    }
  }

  ensureCharityRefresh(limit = 100): Promise<void> {
    if (this.charityRefreshInFlight) return this.charityRefreshInFlight;

    const inFlight = this.refreshCharityCache(limit).finally(() => {
      if (this.charityRefreshInFlight === inFlight) {
        this.charityRefreshInFlight = undefined;
      }
    });

    this.charityRefreshInFlight = inFlight;
    return inFlight;
  }

  clearCharityCache(pubkey: string): void {
    if (typeof window === 'undefined' || !pubkey) return;
    try {
      const current = this.readStoredCharityCache(1000);
      const filtered = current.filter((charity) => charity.pubkey !== pubkey);
      if (filtered.length) {
        const payload = { v: CHARITIES_CACHE_VERSION, ts: Date.now(), charities: filtered };
        window.localStorage.setItem(CHARITIES_CACHE_KEY, JSON.stringify(payload));
      } else {
        window.localStorage.removeItem(CHARITIES_CACHE_KEY);
      }
      window.localStorage.removeItem(this.charityDetailCacheKey(pubkey));
    } catch {
      try {
        window.localStorage.removeItem(CHARITIES_CACHE_KEY);
        window.localStorage.removeItem(this.charityDetailCacheKey(pubkey));
      } catch {
        // ignore storage errors
      }
    }
  }

  private async refreshCharityCache(limit = 100): Promise<void> {
    const appRelays = this.getActiveRelays();
    const kind0Relays = this.getKind0ReadRelays();
    const relayMode = this.getRelayMode();

    const charityEvents = await this.pool.querySync(appRelays, {
      kinds: [KIND_CHARITY_PROFILE],
      '#d': ['proofofheart-charity-profile-v1'],
      limit: Math.max(limit * 2, limit + 50)
    });

    const pubkeys = [...new Set(charityEvents.map((e: any) => e.pubkey))];
    if (!pubkeys.length) {
      if (relayMode === 'test') {
        this.writeCharityCache([]);
      }
      return;
    }

    const cachedFollowerCounts = this.readCachedFollowerCounts(pubkeys);

    const profileEvents = await this.pool.querySync(kind0Relays, {
      kinds: [0],
      authors: pubkeys,
      limit: Math.max(limit * 2, pubkeys.length * 2, 100)
    });

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

    const charities: CharityProfile[] = [];
    for (const [pubkey, charityEvent] of latestCharity.entries()) {
      const metadata = metadataByPubkey.get(pubkey) || {};
      const extra = this.safeJson(charityEvent.content) as CharityExtraFields;

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
        followers: cachedFollowerCounts.get(pubkey) ?? 0,
        followersLoaded: cachedFollowerCounts.has(pubkey),
        profileUpdatedAt: Number((charityEvent as any).created_at) || 0,
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
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

    this.writeCharityCache(sortCharityProfiles(charities));
  }

  private charityDetailCacheKey(pubkey: string): string {
    return `${CHARITY_DETAIL_CACHE_PREFIX}${pubkey}`;
  }

  cacheCharityDetail(charity: CharityProfile): void {
    if (typeof window === 'undefined' || !charity?.pubkey) return;
    try {
      const payload = { v: CHARITIES_CACHE_VERSION, ts: Date.now(), charity };
      window.localStorage.setItem(this.charityDetailCacheKey(charity.pubkey), JSON.stringify(payload));
    } catch {
      // ignore quota / storage errors
    }
  }

  readCharityDetailCache(pubkey: string, maxAgeMs = CHARITIES_CACHE_TTL_DETAIL_MS): CharityProfile | null {
    if (typeof window === 'undefined' || !pubkey) return null;
    try {
      const raw = window.localStorage.getItem(this.charityDetailCacheKey(pubkey));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.v !== CHARITIES_CACHE_VERSION) {
        window.localStorage.removeItem(this.charityDetailCacheKey(pubkey));
        return null;
      }
      const ts = Number(parsed?.ts);
      if (!Number.isFinite(ts) || Date.now() - ts > maxAgeMs) {
        window.localStorage.removeItem(this.charityDetailCacheKey(pubkey));
        return null;
      }
      const charity = this.coerceCachedCharity(parsed?.charity);
      if (!charity) return null;
      const hydratedFollowers = this.readCachedFollowerCounts([pubkey]).get(pubkey);
      if (hydratedFollowers === undefined || hydratedFollowers === charity.followers) {
        return charity;
      }

      const updated = { ...charity, followers: hydratedFollowers };
      this.cacheCharityDetail(updated);
      return updated;
    } catch {
      try {
        window.localStorage.removeItem(this.charityDetailCacheKey(pubkey));
      } catch {
        // ignore
      }
      return null;
    }
  }

  readCachedCharity(pubkey: string, maxAgeMs = CHARITIES_CACHE_TTL_DETAIL_MS): CharityProfile | null {
    const detailCached = this.readCharityDetailCache(pubkey, maxAgeMs);
    if (detailCached) return detailCached;

    try {
      // The homepage list cache is intentionally longer-lived than the detail cache,
      // so detail pages can still render instantly even when only the list cache exists.
      const listCached = this.readCharityCache(500, CHARITIES_CACHE_TTL_HOME_MS);
      return listCached.find((charity) => charity.pubkey === pubkey) ?? null;
    } catch {
      return null;
    }
  }

  private coerceCachedCharity(record: any): CharityProfile | null {
    if (!record || typeof record !== 'object') return null;
    if (typeof record.pubkey !== 'string' || typeof record.npub !== 'string' || typeof record.name !== 'string') return null;

    const followers = Number(record.followers);
    const followersLoaded = typeof record.followersLoaded === 'boolean'
      ? record.followersLoaded
      : Number.isFinite(followers);

    return {
      pubkey: record.pubkey,
      npub: record.npub,
      name: record.name,
      about: typeof record.about === 'string' ? record.about : '',
      picture: typeof record.picture === 'string' ? record.picture : undefined,
      website: typeof record.website === 'string' ? record.website : undefined,
      lud16: typeof record.lud16 === 'string' ? record.lud16 : undefined,
      lud06: typeof record.lud06 === 'string' ? record.lud06 : undefined,
      followers: Number.isFinite(followers) ? Math.max(0, Math.floor(followers)) : 0,
      followersLoaded,
      flags: Number.isFinite(Number(record.flags)) ? Number(record.flags) : 0,
      profileUpdatedAt: Number.isFinite(Number(record.profileUpdatedAt)) ? Number(record.profileUpdatedAt) : undefined,
      hidden: Boolean(record.hidden),
      ratingAvg: Number.isFinite(Number(record.ratingAvg)) ? Number(record.ratingAvg) : 0,
      ratingCount: Number.isFinite(Number(record.ratingCount)) ? Number(record.ratingCount) : 0,
      zappedSats: Number.isFinite(Number(record.zappedSats)) ? Number(record.zappedSats) : 0,
      charity: {
        shortDescription: typeof record.charity?.shortDescription === 'string' ? record.charity.shortDescription : undefined,
        description: typeof record.charity?.description === 'string' ? record.charity.description : undefined,
        country: typeof record.charity?.country === 'string' ? record.charity.country : undefined,
        category: typeof record.charity?.category === 'string' ? record.charity.category : undefined,
        donationMessage: typeof record.charity?.donationMessage === 'string' ? record.charity.donationMessage : undefined,
        lightningAddress: typeof record.charity?.lightningAddress === 'string' ? record.charity.lightningAddress : undefined,
        isVisible: typeof record.charity?.isVisible === 'boolean' ? record.charity.isVisible : undefined
      }
    };
  }

  private extractFollowersCount(payload: any): number | null {
    if (!payload || typeof payload !== 'object') return null;

    const candidates = [
      payload?.followers_count,
      payload?.followersCount,
      payload?.user?.followers_count,
      payload?.user?.followersCount,
      payload?.profile?.followers_count,
      payload?.profile?.followersCount,
      payload?.stats?.followers_count,
      payload?.stats?.followersCount
    ];

    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }

    if (typeof payload.content === 'string') {
      const nested = this.safeJson(payload.content);
      const nestedCount = this.extractFollowersCount(nested);
      if (nestedCount !== null) return nestedCount;
    }

    return null;
  }

  private async queryPrimalFollowerCount(pubkey: string, timeoutMs = 2_500): Promise<number | null> {
    if (typeof window === 'undefined' || typeof WebSocket === 'undefined') return null;

    return new Promise<number | null>((resolve) => {
      let settled = false;
      let ws: WebSocket | null = null;

      const finish = (value: number | null) => {
        if (settled) return;
        settled = true;
        try {
          ws?.close();
        } catch {
          // ignore
        }
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
          const req = ['REQ', `poh-profile-${pubkey.slice(0, 12)}-${Date.now()}`, {
            cache: ['user_profile', { pubkey }]
          }];
          ws?.send(JSON.stringify(req));
        } catch {
          clearTimeout(timer);
          finish(null);
        }
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(String(msg.data));
          if (Array.isArray(parsed)) {
            const type = parsed[0];
            if (type === 'EVENT' && parsed.length >= 3) {
              const count = this.extractFollowersCount(parsed[2]);
              if (count !== null) {
                clearTimeout(timer);
                finish(count);
                return;
              }
            }
            if (type === 'EOSE') {
              clearTimeout(timer);
              finish(null);
              return;
            }
          }

          const count = this.extractFollowersCount(parsed);
          if (count !== null) {
            clearTimeout(timer);
            finish(count);
          }
        } catch {
          // ignore parse failures and keep listening until timeout/eose
        }
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

  private async loadStableFollowerCounts(pubkeys: string[], relayFollowerMap: Map<string, Set<string>>): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const now = Date.now();
    const cache = this.readFollowerCache();

    const staleOrMissing: string[] = [];
    for (const pubkey of pubkeys) {
      const cached = cache[pubkey];
      if (cached && Number.isFinite(cached.value) && (now - cached.ts) < FOLLOWERS_CACHE_TTL_MS) {
        result.set(pubkey, Math.max(0, Math.floor(cached.value)));
      } else {
        staleOrMissing.push(pubkey);
      }
    }

    if (!staleOrMissing.length) return result;

    // Query follower counts concurrently instead of serially.
    // Serial primal queries can make first-load charity rendering very slow.
    const CONCURRENCY = 12;
    const queue = [...staleOrMissing];

    const worker = async () => {
      while (queue.length > 0) {
        const pubkey = queue.shift();
        if (!pubkey) return;

        const primalCount = await this.queryPrimalFollowerCount(pubkey);
        if (primalCount !== null) {
          result.set(pubkey, primalCount);
          cache[pubkey] = { value: primalCount, ts: now };
          continue;
        }

        const fallback = relayFollowerMap.get(pubkey)?.size;
        if (typeof fallback === 'number' && fallback >= 0) {
          result.set(pubkey, fallback);
          continue;
        }

        const previous = cache[pubkey];
        if (!result.has(pubkey) && previous && Number.isFinite(previous.value)) {
          result.set(pubkey, Math.max(0, Math.floor(previous.value)));
        }
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, staleOrMissing.length) }, () => worker());
    await Promise.all(workers);

    this.writeFollowerCache(cache);
    return result;
  }

  async loadCharitiesFast(limit = 100, cacheMaxAgeMs = CHARITIES_CACHE_TTL_HOME_MS): Promise<CharityLoadResult> {
    const cached = this.readCharityCache(limit, cacheMaxAgeMs);
    if (cached.length) {
      void this.refreshCharityCache(limit).catch((e) => console.warn('Background charity cache refresh failed', e));
      return { charities: cached, fromCache: true };
    }

    const appRelays = this.getActiveRelays();
    const kind0Relays = this.getKind0ReadRelays();

    const charityEvents = await this.pool.querySync(appRelays, {
      kinds: [KIND_CHARITY_PROFILE],
      '#d': ['proofofheart-charity-profile-v1'],
      limit: Math.max(limit * 2, limit + 50)
    });

    const pubkeys = [...new Set(charityEvents.map((e: any) => e.pubkey))];
    if (!pubkeys.length) return { charities: [], fromCache: false };

    const cachedFollowerCounts = this.readCachedFollowerCounts(pubkeys);

    const profileEvents = await this.pool.querySync(kind0Relays, {
      kinds: [0],
      authors: pubkeys,
      limit: Math.max(limit * 2, pubkeys.length * 2, 100)
    });

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

    const charities: CharityProfile[] = [];

    for (const [pubkey, charityEvent] of latestCharity.entries()) {
      const metadata = metadataByPubkey.get(pubkey) || {};
      const extra = this.safeJson(charityEvent.content) as CharityExtraFields;

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
        followers: cachedFollowerCounts.get(pubkey) ?? 0,
        followersLoaded: cachedFollowerCounts.has(pubkey),
        profileUpdatedAt: Number((charityEvent as any).created_at) || 0,
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
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

    const sorted = sortCharityProfiles(charities);
    this.writeCharityCache(sorted);
    return { charities: sorted, fromCache: false };
  }

  async loadCharities(limit = 100): Promise<CharityProfile[]> {
    const appRelays = this.getActiveRelays();
    const kind0Relays = this.getKind0ReadRelays();

    const charityEvents = await this.pool.querySync(appRelays, {
      kinds: [KIND_CHARITY_PROFILE],
      '#d': ['proofofheart-charity-profile-v1'],
      // Keep an over-fetch buffer for relay duplicates, but avoid very high fan-out.
      // This reduces 30078 fetch payload without changing selection semantics.
      limit: Math.max(limit * 2, limit + 50)
    });

    const pubkeys = [...new Set(charityEvents.map((e: any) => e.pubkey))];
    if (!pubkeys.length) return [];

    const profileEvents = await this.pool.querySync(kind0Relays, {
      kinds: [0],
      authors: pubkeys,
      // Same strategy as 30078: enough headroom for duplicates + replaceable history,
      // while reducing load on large relay responses.
      limit: Math.max(limit * 2, pubkeys.length * 2, 100)
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

    const stableFollowerCounts = await this.loadStableFollowerCounts(pubkeys, followerMap);

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
        followers: stableFollowerCounts.get(pubkey) ?? followerMap.get(pubkey)?.size ?? 0,
        followersLoaded: true,
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

    const sorted = sortCharityProfiles(charities);
    this.writeCharityCache(sorted);
    return sorted;
  }

  private safeJson(content: string): any {
    try {
      return JSON.parse(content || '{}');
    } catch {
      return {};
    }
  }
}


