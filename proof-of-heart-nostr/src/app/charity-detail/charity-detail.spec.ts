import { CharityDetailComponent, normalizeCharityWebsiteHref } from './charity-detail';

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

describe('CharityDetailComponent Android zap flow', () => {
  const originalNostr = (window as any).nostr;
  const originalUserAgent = navigator.userAgent;

  function setAndroidUserAgent() {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
      configurable: true
    });
  }

  afterEach(() => {
    (window as any).nostr = originalNostr;
    Object.defineProperty(navigator, 'userAgent', { value: originalUserAgent, configurable: true });
  });

  it('opens the native Android signer directly instead of trying a stored Nostr Connect session first', async () => {
    setAndroidUserAgent();
    (window as any).nostr = undefined;
    const component: any = Object.create(CharityDetailComponent.prototype);
    component.nostr = {
      hasNip07Signer: () => false,
      hasNip46Session: () => true
    };
    component.prepareDonation = jasmine.createSpy('prepareDonation').and.callFake(() => {
      component.donationAttemptToken = 1;
      component.showDonateModal = true;
      return true;
    });
    component.donationInput = 21;
    component.donationMode = 'sats';
    Object.defineProperty(component, 'donationAddress', { value: 'charity@example.org', configurable: true });
    component.startAndroidSignerZap = jasmine.createSpy('startAndroidSignerZap').and.resolveTo(undefined);
    component.createNip57ZapInvoice = jasmine.createSpy('createNip57ZapInvoice').and.rejectWith(new Error('should not use stored signer on Android'));
    component.isCurrentDonationAttempt = () => true;
    component.donationErrorMessage = (err: any) => err?.message || String(err);

    await component.zapWithNostr();

    expect(component.startAndroidSignerZap).toHaveBeenCalledOnceWith('charity@example.org', 21, jasmine.any(Number));
    expect(component.createNip57ZapInvoice).not.toHaveBeenCalled();
  });

  it('uses a clean Amber callback prefix and recovers the directly appended signed event', async () => {
    const component: any = Object.create(CharityDetailComponent.prototype);
    const pending = {
      requestId: 'req-1',
      callback: 'https://ln.example.org/callback',
      amountMsat: 21000,
      sats: 21,
      since: 123456,
      createdAt: 123456000
    };
    const signedZap = encodeURIComponent(JSON.stringify({ kind: 9734, id: 'zap-id', pubkey: 'donor-pubkey', sig: 'sig' }));
    history.replaceState({}, '', `/charities/${'a'.repeat(64)}${signedZap}`);
    component.nip55DebugMode = false;
    component.debugNip55 = () => undefined;
    component.currentNip55HandoffState = () => ({});
    component.peekPendingAndroidSignerZap = () => pending;
    component.takePendingAndroidSignerZap = () => pending;
    component.toast = jasmine.createSpy('toast');
    component.charity = { pubkey: 'a'.repeat(64) };
    component.showDonateModal = true;
    component.createInvoiceFromSignedZap = jasmine.createSpy('createInvoiceFromSignedZap').and.resolveTo({
      invoice: 'lnbc1invoice',
      donorPubkey: 'donor-pubkey',
      zapRequestId: 'zap-id'
    });
    component.withTimeout = (promise: Promise<any>) => promise;
    component.isCurrentDonationAttempt = () => true;
    component.presentInvoice = jasmine.createSpy('presentInvoice').and.resolveTo(undefined);
    component.writePendingZapPayment = jasmine.createSpy('writePendingZapPayment');
    component.watchForZapReceipt = jasmine.createSpy('watchForZapReceipt');

    await component.resumeAndroidSignerZapIfPresent();

    expect(component.createInvoiceFromSignedZap).toHaveBeenCalledWith('https://ln.example.org/callback', 21000, jasmine.objectContaining({ id: 'zap-id' }));
    expect(component.presentInvoice).toHaveBeenCalled();
  });
});
