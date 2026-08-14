import { buildAndroidSignerZapCallbackUrl, normalizeCharityWebsiteHref } from './charity-detail';

describe('buildAndroidSignerZapCallbackUrl', () => {
  const charityPubkey = 'a'.repeat(64);

  it('uses the clean charity page URL without request-id query state for donor signer callbacks', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey}`))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}`);
  });

  it('removes legacy path callback markers before creating a new Android signer callback URL', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey};androidSignerZap=old:%7B%7D`))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}`);
  });

  it('removes directly appended signed-event JSON before creating a new Android signer callback URL', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey}%7B%22kind%22%3A9734%7D`))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}`);
  });
});

describe('normalizeCharityWebsiteHref', () => {
  it('keeps absolute http and https charity websites unchanged', () => {
    expect(normalizeCharityWebsiteHref('https://myfirstbitcoin.org')).toBe('https://myfirstbitcoin.org/');
    expect(normalizeCharityWebsiteHref('http://example.org/path')).toBe('http://example.org/path');
  });

  it('adds https to domain-only charity websites so links are external', () => {
    expect(normalizeCharityWebsiteHref('myfirstbitcoin.org')).toBe('https://myfirstbitcoin.org/');
    expect(normalizeCharityWebsiteHref('www.myfirstbitcoin.org/learn')).toBe('https://www.myfirstbitcoin.org/learn');
  });

  it('rejects non-web protocols', () => {
    expect(normalizeCharityWebsiteHref('javascript:alert(1)')).toBe('');
    expect(normalizeCharityWebsiteHref('mailto:hello@example.org')).toBe('');
  });
});
