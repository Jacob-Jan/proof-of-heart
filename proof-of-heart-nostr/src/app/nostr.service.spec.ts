import { mergeCharityProfiles, sortCharityProfiles, CharityProfile, NostrService } from './nostr.service';

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
    expect(merged.charity.shortDescription).toBe('fresh short');
    expect(merged.charity.description).toBe('');
    expect(merged.charity.donationMessage).toBe('cached donate');
    expect(merged.charity.lightningAddress).toBe('cached@example.com');
  });

  it('sorts by profile recency and keeps Proof of Heart last', () => {
    const sorted = sortCharityProfiles([
      {
        pubkey: 'c',
        npub: 'npub1c',
        name: 'Zebra Relief',
        about: '',
        followers: 0,
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 100,
        charity: {}
      },
      {
        pubkey: 'a',
        npub: 'npub1a',
        name: 'Alpha Aid',
        about: '',
        followers: 0,
        flags: 0,
        hidden: false,
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
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 999,
        charity: {}
      }
    ] as CharityProfile[]);

    expect(sorted.map((c) => c.name)).toEqual(['Alpha Aid', 'Zebra Relief', 'Proof of Heart']);
  });

  it('keeps equal-recency charities in their existing order instead of alphabetizing them', () => {
    const sorted = sortCharityProfiles([
      {
        pubkey: 'zebra',
        npub: 'npub1zebra',
        name: 'Zebra Relief',
        about: '',
        followers: 0,
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 100,
        charity: {}
      },
      {
        pubkey: 'alpha',
        npub: 'npub1alpha',
        name: 'Alpha Aid',
        about: '',
        followers: 0,
        flags: 0,
        hidden: false,
        ratingAvg: 0,
        ratingCount: 0,
        zappedSats: 0,
        profileUpdatedAt: 100,
        charity: {}
      }
    ] as CharityProfile[]);

    expect(sorted.map((c) => c.name)).toEqual(['Zebra Relief', 'Alpha Aid']);
  });
});


describe('NostrService charity refresh', () => {
  it('deduplicates in-flight relay refreshes until the current one completes', async () => {
    const service = new NostrService();
    const refreshSpy = spyOn(service as any, 'refreshCharityCache').and.returnValue(Promise.resolve());

    const first = service.ensureCharityRefresh(25);
    const second = service.ensureCharityRefresh(200);

    expect(second).toBe(first);
    await first;
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith(25);

    const third = service.ensureCharityRefresh(300);
    expect(third).not.toBe(first);
    expect(refreshSpy).toHaveBeenCalledTimes(2);
    expect(refreshSpy).toHaveBeenCalledWith(300);
  });

  it('clears cached list and detail entries for a profile after save', () => {
    const service = new NostrService();
    const pubkey = 'saved-profile-pubkey';
    const otherPubkey = 'other-pubkey';

    localStorage.setItem('poh_charities_cache_v2', JSON.stringify({
      v: 2,
      ts: Date.now(),
      charities: [
        { pubkey, npub: 'npub1saved', name: 'Old profile', followers: 10, followersLoaded: true, charity: { isVisible: true } },
        { pubkey: otherPubkey, npub: 'npub1other', name: 'Other profile', followers: 20, followersLoaded: true, charity: { isVisible: true } }
      ]
    }));
    localStorage.setItem(`poh_charity_detail_cache_v1:${pubkey}`, JSON.stringify({
      v: 2,
      ts: Date.now(),
      charity: { pubkey, npub: 'npub1saved', name: 'Old profile', followers: 10, followersLoaded: true, charity: { isVisible: true } }
    }));

    service.clearCharityCache(pubkey);

    const parsed = JSON.parse(localStorage.getItem('poh_charities_cache_v2') || '{}');
    expect(parsed.charities.length).toBe(1);
    expect(parsed.charities[0].pubkey).toBe(otherPubkey);
    expect(localStorage.getItem(`poh_charity_detail_cache_v1:${pubkey}`)).toBeNull();
  });
});

