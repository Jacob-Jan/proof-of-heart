import { mergeCharityProfiles, CharityProfile } from './nostr.service';

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
});
