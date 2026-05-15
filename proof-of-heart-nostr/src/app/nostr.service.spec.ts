import { mergeCharityProfiles, sortCharityProfiles, CharityProfile } from './nostr.service';

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
    expect(merged.charity.shortDescription).toBe('cached short');
    expect(merged.charity.description).toBe('cached description');
    expect(merged.charity.donationMessage).toBe('cached donate');
    expect(merged.charity.lightningAddress).toBe('cached@example.com');
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
