import { buildKind0ProfileMetadata, buildNativeAndroidSignerConnectUrl, ensureEventPubkeyForNip07, getNip46ProfilePermissions, hasCharityProfileChanges, mergeCharityProfiles, parseNativeAndroidSignerPubkeyFromClipboard, parseNativeAndroidSignerPubkeyFromUrl, parseNip57ZapReceipt, ratingStatsByRecipient, sortCharityProfiles, totalZapSatsByRecipient, zapReceiptSats, CharityProfile, NostrService } from './nostr.service';

describe('buildKind0ProfileMetadata', () => {
  it('updates editable Nostr profile fields while preserving unknown metadata', () => {
    const existing = {
      name: 'Old Name',
      display_name: 'Old Display',
      about: 'Old about',
      picture: 'https://example.org/old.png',
      banner: 'https://example.org/banner.png',
      nip05: 'charity@example.org',
      lud16: 'donate@example.org'
    };

    const next = buildKind0ProfileMetadata(existing, {
      name: 'My First Bitcoin',
      about: 'Bitcoin education',
      picture: 'https://myfirstbitcoin.org/logo.png',
      lud16: 'hello@myfirstbitcoin.org'
    });

    expect(next).toEqual({
      ...existing,
      name: 'My First Bitcoin',
      display_name: 'My First Bitcoin',
      about: 'Bitcoin education',
      picture: 'https://myfirstbitcoin.org/logo.png',
      lud16: 'hello@myfirstbitcoin.org'
    });
  });

  it('removes editable fields when the user clears them without touching unrelated fields', () => {
    const next = buildKind0ProfileMetadata(
      { name: 'Old Name', display_name: 'Old Display', about: 'Old about', picture: 'https://example.org/old.png', lud16: 'old@example.org', nip05: 'charity@example.org' },
      { name: '', about: '', picture: '', lud16: '' }
    );

    expect(next).toEqual({ nip05: 'charity@example.org' });
  });
});

describe('native Android signer connect helpers', () => {
  it('builds a signer-neutral get_public_key URL without a browser callback', () => {
    const url = buildNativeAndroidSignerConnectUrl('https://proofofheart.org/charity/onboard');

    expect(url).toContain('nostrsigner:');
    expect(url).toContain('type=get_public_key');
    expect(url).not.toContain('callbackUrl=');
    expect(url).not.toContain('Amber');
  });

  it('parses the pubkey returned by a native signer callback and strips it from the clean URL', () => {
    const pubkey = 'a'.repeat(64);
    const parsed = parseNativeAndroidSignerPubkeyFromUrl(`https://proofofheart.org/charity/onboard?pohSignerConnect=${pubkey}&x=1`);

    expect(parsed?.pubkey).toBe(pubkey);
    expect(parsed?.cleanUrl).toBe('https://proofofheart.org/charity/onboard?x=1');
  });

  it('parses the pubkey copied by a native signer when no callback URL is provided', () => {
    const pubkey = 'b'.repeat(64);

    expect(parseNativeAndroidSignerPubkeyFromClipboard(pubkey)).toBe(pubkey);
    expect(parseNativeAndroidSignerPubkeyFromClipboard(`  ${pubkey}  `)).toBe(pubkey);
    expect(parseNativeAndroidSignerPubkeyFromClipboard(`nostrsigner:${pubkey}`)).toBe(pubkey);
    expect(parseNativeAndroidSignerPubkeyFromClipboard('not-a-pubkey')).toBeNull();
  });
});

describe('ensureEventPubkeyForNip07', () => {
  it('adds the signer pubkey before signEvent for Flamingo compatibility', async () => {
    const event = {
      kind: 1,
      created_at: 123,
      tags: [],
      content: 'hello world'
    };

    const withPubkey = await ensureEventPubkeyForNip07(event, async () => 'donor-pubkey');

    expect(withPubkey).toEqual({ ...event, pubkey: 'donor-pubkey' });
    expect('pubkey' in event).toBeFalse();
  });

  it('keeps an existing pubkey without asking the signer again', async () => {
    const event = {
      kind: 9734,
      created_at: 123,
      tags: [],
      content: '',
      pubkey: 'existing-pubkey'
    };
    let askedForPubkey = false;

    const withPubkey = await ensureEventPubkeyForNip07(event, async () => {
      askedForPubkey = true;
      return 'other-pubkey';
    });

    expect(withPubkey).toEqual(event);
    expect(askedForPubkey).toBeFalse();
  });
});

describe('profile editor save helpers', () => {
  it('does not treat a cleared legacy shortDescription as an app profile change by itself', () => {
    expect(hasCharityProfileChanges(
      { description: 'Long', country: 'El Salvador', category: 'Education', isVisible: true },
      { description: 'Long', country: 'El Salvador', category: 'Education', isVisible: true, shortDescription: '' }
    )).toBeFalse();
  });

  it('does not treat legacy app-specific lightningAddress changes as app profile changes', () => {
    expect(hasCharityProfileChanges(
      { description: 'Long', country: 'El Salvador', category: 'Education', isVisible: true, lightningAddress: 'old@example.com' },
      { description: 'Long', country: 'El Salvador', category: 'Education', isVisible: true, lightningAddress: '' }
    )).toBeFalse();
  });

  it('detects real app profile field changes', () => {
    expect(hasCharityProfileChanges(
      { description: 'Long', country: 'El Salvador', category: 'Education', isVisible: true },
      { description: 'Updated', country: 'El Salvador', category: 'Education', isVisible: true, shortDescription: '' }
    )).toBeTrue();
  });
});

describe('NIP-46 profile editing permissions', () => {
  it('requests permissions for all profile editor signing actions', () => {
    const permissions = getNip46ProfilePermissions();

    expect(permissions).toContain('sign_event:0');
    expect(permissions).toContain('sign_event:24242');
    expect(permissions).toContain('sign_event:30078');
    expect(permissions).toContain('get_public_key');
  });
});

describe('publishCharityProfile', () => {
  let originalNostr: any;

  beforeEach(() => {
    originalNostr = (window as any).nostr;
    delete (window as any).nostr;
    window.localStorage.setItem('poh_nip46_session_v1', JSON.stringify({
      clientSecretKey: '1'.repeat(64),
      clientPubkey: '2'.repeat(64),
      relays: ['wss://relay.example'],
      remotePubkey: '3'.repeat(64),
      userPubkey: '4'.repeat(64),
      createdAt: Date.now()
    }));
    window.localStorage.setItem('poh_last_pubkey', '4'.repeat(64));
  });

  afterEach(() => {
    if (originalNostr) (window as any).nostr = originalNostr;
    else delete (window as any).nostr;
    window.localStorage.removeItem('poh_nip46_session_v1');
    window.localStorage.removeItem('poh_last_pubkey');
  });

  it('uses the shared signer abstraction so remote signers can publish app profile events', async () => {
    const service = new NostrService();
    const signed = { id: 'signed-charity-profile', pubkey: '4'.repeat(64), kind: 30078, tags: [], content: '{}' };
    spyOn(service as any, 'signEventWithAvailableSigner').and.resolveTo(signed);
    spyOn(service as any, 'loadAuthorWriteRelays').and.resolveTo([]);
    (service as any).pool = {
      publish: () => [Promise.resolve('ok')],
      querySync: async () => [signed]
    };

    const id = await service.publishCharityProfile({ description: 'Long description', isVisible: true });

    expect(id).toBe('signed-charity-profile');
    expect((service as any).signEventWithAvailableSigner).toHaveBeenCalled();
  });
});

describe('mergeCharityProfiles', () => {
  it('preserves cached visual and follower fields when live refresh omits them', () => {
    const cached: CharityProfile = {
      pubkey: 'cached-pubkey',
      npub: 'npub1cached',
      name: 'Cached charity',
      about: 'cached about',
      picture: 'https://example.com/cached.png',
      website: 'https://example.com',
      lud16: 'cached@example.com',
      lud06: 'lnurl1cached',
      followers: 42,
      followersLoaded: true,
      activityLoaded: true,
      flags: 2,
      hidden: false,
      ratingAvg: 4.5,
      ratingCount: 9,
      zappedSats: 1234,
      profileUpdatedAt: 200,
      charity: {
        shortDescription: 'cached short',
        description: 'cached description',
        country: 'US',
        category: 'Education',
        donationMessage: 'cached donate',
        lightningAddress: 'cached@example.com',
        isVisible: true
      }
    };

    const fresh: CharityProfile = {
      ...cached,
      about: '',
      picture: undefined,
      website: undefined,
      lud16: undefined,
      lud06: undefined,
      followers: 0,
      followersLoaded: false,
      activityLoaded: false,
      flags: 0,
      hidden: false,
      ratingAvg: 0,
      ratingCount: 0,
      zappedSats: 0,
      profileUpdatedAt: 100,
      charity: {
        shortDescription: 'fresh short',
        description: '',
        country: 'US',
        category: 'Education',
        donationMessage: undefined,
        lightningAddress: undefined,
        isVisible: true
      }
    };

    const [merged] = mergeCharityProfiles([cached], [fresh]);

    expect(merged.picture).toBe(cached.picture);
    expect(merged.website).toBe(cached.website);
    expect(merged.followers).toBe(cached.followers);
    expect(merged.followersLoaded).toBeTrue();
    expect(merged.flags).toBe(2);
    expect(merged.ratingAvg).toBe(4.5);
    expect(merged.ratingCount).toBe(9);
    expect(merged.zappedSats).toBe(1234);
    expect(merged.activityLoaded).toBeTrue();
    expect(merged.charity.shortDescription).toBe('cached short');
    expect(merged.charity.description).toBe('cached description');
    expect(merged.charity.donationMessage).toBe('cached donate');
    expect(merged.charity.lightningAddress).toBe('cached@example.com');
    expect(merged.profileUpdatedAt).toBe(200);
  });

  it('keeps cached activity chips when a newer minimal refresh has not loaded them yet', () => {
    const cached: CharityProfile = {
      pubkey: 'cached-pubkey',
      npub: 'npub1cached',
      name: 'Cached charity',
      about: 'cached about',
      followers: 42,
      followersLoaded: true,
      activityLoaded: true,
      flags: 2,
      hidden: false,
      ratingAvg: 4.5,
      ratingCount: 9,
      zappedSats: 1234,
      profileUpdatedAt: 100,
      charity: { isVisible: true }
    };

    const fresh: CharityProfile = {
      ...cached,
      followersLoaded: false,
      activityLoaded: false,
      flags: 0,
      hidden: false,
      ratingAvg: 0,
      ratingCount: 0,
      zappedSats: 0,
      profileUpdatedAt: 200
    };

    const [merged] = mergeCharityProfiles([cached], [fresh]);

    expect(merged.flags).toBe(2);
    expect(merged.ratingAvg).toBe(4.5);
    expect(merged.ratingCount).toBe(9);
    expect(merged.zappedSats).toBe(1234);
    expect(merged.activityLoaded).toBeTrue();
    expect(merged.profileUpdatedAt).toBe(200);
  });

  it('updates cached profile fields when the incoming snapshot is newer', () => {
    const cached: CharityProfile = {
      pubkey: 'cached-pubkey',
      npub: 'npub1cached',
      name: 'Cached charity',
      about: 'cached about',
      followers: 42,
      followersLoaded: true,
      activityLoaded: true,
      flags: 2,
      hidden: false,
      ratingAvg: 4.5,
      ratingCount: 9,
      zappedSats: 1234,
      profileUpdatedAt: 100,
      charity: {
        shortDescription: 'cached short',
        description: 'cached description',
        country: 'US',
        category: 'Education',
        donationMessage: 'cached donate',
        lightningAddress: 'cached@example.com',
        isVisible: true
      }
    };

    const fresh: CharityProfile = {
      ...cached,
      about: 'fresh about',
      followers: 99,
      followersLoaded: true,
      profileUpdatedAt: 200,
      charity: {
        shortDescription: 'fresh short',
        description: 'fresh description',
        country: 'GB',
        category: 'Health',
        donationMessage: 'fresh donate',
        lightningAddress: 'fresh@example.com',
        isVisible: false
      }
    };

    const [merged] = mergeCharityProfiles([cached], [fresh]);

    expect(merged.about).toBe('fresh about');
    expect(merged.followers).toBe(99);
    expect(merged.profileUpdatedAt).toBe(200);
    expect(merged.charity.shortDescription).toBe('fresh short');
    expect(merged.charity.country).toBe('GB');
    expect(merged.charity.isVisible).toBeFalse();
  });

  it('does not keep cached charities that are missing from an authoritative relay refresh', () => {
    const cachedMissing: CharityProfile = {
      pubkey: 'missing-pubkey',
      npub: 'npub1missing',
      name: 'Temporarily Missing Charity',
      about: 'cached about',
      followers: 0,
      followersLoaded: false,
      flags: 0,
      hidden: false,
      ratingAvg: 0,
      ratingCount: 0,
      zappedSats: 0,
      profileUpdatedAt: 100,
      charity: { shortDescription: 'cached short', isVisible: true }
    };

    const freshOnly: CharityProfile = {
      pubkey: 'fresh-pubkey',
      npub: 'npub1fresh',
      name: 'Fresh Charity',
      about: '',
      followers: 0,
      followersLoaded: false,
      flags: 0,
      hidden: false,
      ratingAvg: 0,
      ratingCount: 0,
      zappedSats: 0,
      profileUpdatedAt: 200,
      charity: { isVisible: true }
    };

    const merged = mergeCharityProfiles([cachedMissing], [freshOnly]);

    expect(merged.map((charity) => charity.pubkey)).not.toContain('missing-pubkey');
    expect(merged.map((charity) => charity.pubkey)).toContain('fresh-pubkey');
  });
});

describe('sortCharityProfiles', () => {
  it('sorts by recency and keeps Proof of Heart last', () => {
    const sorted = sortCharityProfiles([
      {
        pubkey: 'older',
        npub: 'npub1older',
        name: 'Older Charity',
        about: '',
        followers: 0,
        hidden: false,
        flags: 0,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 100,
        charity: {}
      },
      {
        pubkey: 'newer',
        npub: 'npub1newer',
        name: 'Newer Charity',
        about: '',
        followers: 0,
        hidden: false,
        flags: 0,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 200,
        charity: {}
      },
      {
        pubkey: '1839e595671de0af8cb8a217f2aa579bb84c14a5d6f50ac466ef78676ec94b2d',
        npub: 'npub1poh',
        name: 'Proof of Heart',
        about: '',
        followers: 0,
        hidden: false,
        flags: 0,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 999,
        charity: {}
      }
    ] as CharityProfile[]);

    expect(sorted.map((c) => c.name)).toEqual(['Newer Charity', 'Older Charity', 'Proof of Heart']);
  });
});

describe('zap receipt stats', () => {
  it('counts standard zap receipts from bolt11 tags', () => {
    const receipts = [
      {
        kind: 9735,
        tags: [
          ['p', 'recipient-a'],
          ['bolt11', 'lnbc10u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq']
        ]
      },
      {
        kind: 9735,
        tags: [
          ['p', 'recipient-a'],
          ['bolt11', 'lnbc5u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq']
        ]
      },
      {
        kind: 9735,
        tags: [
          ['p', 'other-recipient'],
          ['bolt11', 'lnbc1u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq']
        ]
      }
    ];

    const totals = totalZapSatsByRecipient(receipts, ['recipient-a']);

    expect(totals.get('recipient-a')).toBe(1500);
    expect(totals.has('other-recipient')).toBeFalse();
  });

  it('deduplicates zap receipts by event id across relays', () => {
    const receipt = {
      id: 'receipt-1',
      kind: 9735,
      created_at: 123456,
      tags: [
        ['p', 'recipient-a'],
        ['bolt11', 'lnbc10u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq']
      ]
    };

    const totals = totalZapSatsByRecipient([receipt, { ...receipt }], ['recipient-a']);

    expect(totals.get('recipient-a')).toBe(1000);
  });

  it('matches the recipient when receipts have multiple p tags', () => {
    const totals = totalZapSatsByRecipient([
      {
        id: 'receipt-1',
        kind: 9735,
        tags: [
          ['p', 'donor-pubkey'],
          ['p', 'recipient-a'],
          ['bolt11', 'lnbc10u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq']
        ]
      }
    ], ['recipient-a']);

    expect(totals.get('recipient-a')).toBe(1000);
  });

  it('prefers the paid bolt11 amount over receipt/request amount tags', () => {
    const sats = zapReceiptSats({
      kind: 9735,
      tags: [
        ['p', 'recipient-a'],
        ['amount', '21000'],
        ['bolt11', 'lnbc10u1p000000pp5qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'],
        ['description', JSON.stringify({
          kind: 9734,
          tags: [['amount', '21000']]
        })]
      ]
    });

    expect(sats).toBe(1000);
  });

  it('parses receipt amount tags with msat suffix when bolt11 is unavailable', () => {
    const sats = zapReceiptSats({
      kind: 9735,
      tags: [
        ['p', 'recipient-a'],
        ['amount', '21000msat']
      ]
    });

    expect(sats).toBe(21);
  });

  it('falls back to the zap request amount in the description tag', () => {
    const sats = zapReceiptSats({
      kind: 9735,
      tags: [
        ['p', 'recipient-a'],
        ['description', JSON.stringify({
          kind: 9734,
          tags: [['amount', '21000']]
        })]
      ]
    });

    expect(sats).toBe(21);
  });

  it('parses display records only from standard NIP-57 zap receipts', () => {
    const receipt = parseNip57ZapReceipt({
      id: 'receipt-1',
      kind: 9735,
      created_at: 123456,
      pubkey: 'lnurl-server',
      tags: [
        ['p', 'recipient-a'],
        ['amount', '21000'],
        ['description', JSON.stringify({
          id: 'zap-request-1',
          kind: 9734,
          pubkey: 'donor-a',
          content: 'great work',
          tags: [['amount', '21000'], ['p', 'recipient-a']]
        })]
      ]
    });

    expect(receipt).toEqual({
      receiptId: 'receipt-1',
      zapRequestId: 'zap-request-1',
      donorPubkey: 'donor-a',
      recipientPubkey: 'recipient-a',
      sats: 21,
      createdAt: 123456,
      comment: 'great work'
    });

    expect(parseNip57ZapReceipt({ kind: 30079, tags: [['p', 'recipient-a']] })).toBeNull();
  });
});


describe('ratingStatsByRecipient', () => {
  it('counts only the latest active rating per rater and recipient', () => {
    const stats = ratingStatsByRecipient([
      { pubkey: 'alice', created_at: 100, tags: [['p', 'charity-a'], ['rating', '5']] },
      { pubkey: 'alice', created_at: 200, tags: [['p', 'charity-a'], ['rating', '3'], ['rating_state', '1']] },
      { pubkey: 'bob', created_at: 150, tags: [['p', 'charity-a'], ['rating', '4']] },
      { pubkey: 'carol', created_at: 180, tags: [['p', 'charity-a'], ['rating', '2']] },
      { pubkey: 'carol', created_at: 210, tags: [['p', 'charity-a'], ['rating_state', '0']] },
      { pubkey: 'dan', created_at: 220, tags: [['p', 'charity-b'], ['rating', '5']] }
    ], ['charity-a']);

    expect(stats.get('charity-a')).toEqual({ total: 7, count: 2 });
    expect(stats.has('charity-b')).toBeFalse();
  });
});
