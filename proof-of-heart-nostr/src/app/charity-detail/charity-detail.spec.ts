import { buildAndroidSignerZapCallbackUrl, normalizeCharityWebsiteHref } from './charity-detail';

describe('buildAndroidSignerZapCallbackUrl', () => {
  const charityPubkey = 'a'.repeat(64);

  it('uses the July-compatible request-id query callback prefix for Android signer callbacks', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey}`, 'zap-123'))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}?androidSignerZap=zap-123%3A`);
  });

  it('removes legacy path callback markers before creating a new Android signer callback URL', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey};androidSignerZap=old:%7B%7D`, 'zap-456'))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}?androidSignerZap=zap-456%3A`);
  });

  it('removes directly appended signed-event JSON before creating a new Android signer callback URL', () => {
    expect(buildAndroidSignerZapCallbackUrl('https://proofofheart.org', `/charities/${charityPubkey}%7B%22kind%22%3A9734%7D`, 'zap-789'))
      .toBe(`https://proofofheart.org/charities/${charityPubkey}?androidSignerZap=zap-789%3A`);
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
