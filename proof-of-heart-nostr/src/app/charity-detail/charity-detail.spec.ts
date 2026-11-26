import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { buildAndroidSignerZapCallbackUrl, charityIdFromRouteSnapshot, CharityDetailComponent, normalizeCharityWebsiteHref, shouldStartNip46ZapPairingBeforeAndroidFallback } from './charity-detail';
import { NostrService } from '../nostr.service';

describe('charityIdFromRouteSnapshot', () => {
  it('uses a hardcoded charity identity supplied by route data', () => {
    const snapshot = {
      data: { charityId: 'npub1hardcoded' },
      paramMap: { get: () => null }
    } as any;

    expect(charityIdFromRouteSnapshot(snapshot)).toBe('npub1hardcoded');
  });

  it('keeps supporting legacy pubkey route parameters', () => {
    const snapshot = {
      data: {},
      paramMap: { get: (name: string) => name === 'pubkey' ? 'npub1legacy' : null }
    } as any;

    expect(charityIdFromRouteSnapshot(snapshot)).toBe('npub1legacy');
  });
});

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

describe('zap signer selection', () => {
  it('starts NIP-46 pairing when no extension signer and no remote session exist', () => {
    expect(shouldStartNip46ZapPairingBeforeAndroidFallback(false, false)).toBeTrue();
  });

  it('does not start pairing when NIP-07 is available or NIP-46 is already paired', () => {
    expect(shouldStartNip46ZapPairingBeforeAndroidFallback(true, false)).toBeFalse();
    expect(shouldStartNip46ZapPairingBeforeAndroidFallback(false, true)).toBeFalse();
  });
});

describe('charity detail loading state', () => {
  it('spaces the loading spinner and text like the home page loading state', async () => {
    await TestBed.configureTestingModule({
      imports: [CharityDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['npub', 'npub1test']])) } },
        { provide: NostrService, useValue: { clearCharityFeedStatus: jasmine.createSpy('clearCharityFeedStatus') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: Meta, useValue: { updateTag: jasmine.createSpy('updateTag') } },
        { provide: Title, useValue: { setTitle: jasmine.createSpy('setTitle') } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CharityDetailComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    component.loading = true;

    fixture.detectChanges();

    const loadingState = fixture.nativeElement.querySelector('.loadingcharity') as HTMLElement;
    const styles = getComputedStyle(loadingState);
    expect(styles.flexDirection).toBe('column');
    expect(styles.alignItems).toBe('center');
    expect(styles.gap).toBe('12px');
  });
});

describe('charity detail description rendering', () => {
  it('renders saved safe HTML tags in the long charity description', async () => {
    await TestBed.configureTestingModule({
      imports: [CharityDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['npub', 'npub1test']])) } },
        { provide: NostrService, useValue: { clearCharityFeedStatus: jasmine.createSpy('clearCharityFeedStatus') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: Meta, useValue: { updateTag: jasmine.createSpy('updateTag') } },
        { provide: Title, useValue: { setTitle: jasmine.createSpy('setTitle') } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CharityDetailComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    component.loading = false;
    component.charity = {
      pubkey: 'a'.repeat(64),
      npub: 'npub1test',
      name: 'HTML Charity',
      about: 'Short',
      picture: '',
      website: '',
      followers: 0,
      ratingAvg: 0,
      ratingCount: 0,
      flags: 0,
      zappedSats: 0,
      activityLoaded: true,
      charity: {
        description: '<p>Line <strong>one</strong></p><ul><li>Two</li></ul>',
        category: 'Education',
        country: 'NL',
        lightningAddress: 'donate@example.org',
        isVisible: true
      }
    } as any;

    fixture.detectChanges();

    const description = fixture.nativeElement.querySelector('.description') as HTMLElement;
    expect(description.querySelector('strong')?.textContent).toBe('one');
    expect(description.querySelector('li')?.textContent).toBe('Two');
    expect(description.textContent).not.toContain('<strong>');
  });

  it('does not add a redundant heading before the long charity description', async () => {
    await TestBed.configureTestingModule({
      imports: [CharityDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['npub', 'npub1test']])) } },
        { provide: NostrService, useValue: { clearCharityFeedStatus: jasmine.createSpy('clearCharityFeedStatus') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: Meta, useValue: { updateTag: jasmine.createSpy('updateTag') } },
        { provide: Title, useValue: { setTitle: jasmine.createSpy('setTitle') } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CharityDetailComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    component.loading = false;
    component.charity = {
      pubkey: 'a'.repeat(64),
      npub: 'npub1test',
      name: 'HTML Charity',
      about: 'Short',
      picture: '',
      website: '',
      followers: 0,
      ratingAvg: 0,
      ratingCount: 0,
      flags: 0,
      zappedSats: 0,
      activityLoaded: true,
      charity: {
        description: '<p>Line <strong>one</strong></p>',
        category: 'Education',
        country: 'NL',
        lightningAddress: 'donate@example.org',
        isVisible: true
      }
    } as any;

    fixture.detectChanges();

    const descriptionColumn = fixture.nativeElement.querySelector('.middle .left') as HTMLElement;
    expect(descriptionColumn.textContent).not.toContain('More about HTML Charity');
    expect(descriptionColumn.querySelector('.description')?.textContent).toContain('Line one');
  });

  it('strips unsafe and unsupported HTML from relay-supplied long descriptions', async () => {
    await TestBed.configureTestingModule({
      imports: [CharityDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['npub', 'npub1test']])) } },
        { provide: NostrService, useValue: { clearCharityFeedStatus: jasmine.createSpy('clearCharityFeedStatus') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: Meta, useValue: { updateTag: jasmine.createSpy('updateTag') } },
        { provide: Title, useValue: { setTitle: jasmine.createSpy('setTitle') } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CharityDetailComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    component.loading = false;
    component.charity = {
      pubkey: 'a'.repeat(64),
      npub: 'npub1test',
      name: 'HTML Charity',
      about: 'Short',
      picture: '',
      website: '',
      followers: 0,
      ratingAvg: 0,
      ratingCount: 0,
      flags: 0,
      zappedSats: 0,
      activityLoaded: true,
      charity: {
        description: '<h1 onclick="alert(1)">Big</h1><p style="color:red">Safe <strong>bold</strong><img src=x onerror="alert(1)"></p><script>alert(1)</script><a href="javascript:alert(2)">bad</a><a href="example.org">good</a><svg><circle></circle></svg>',
        category: 'Education',
        country: 'NL',
        lightningAddress: 'donate@example.org',
        isVisible: true
      }
    } as any;

    fixture.detectChanges();

    const description = fixture.nativeElement.querySelector('.description') as HTMLElement;
    expect(description.querySelector('h1')).withContext('unsupported heading tags should not render').toBeNull();
    expect(description.querySelector('img')).withContext('images should not render from descriptions').toBeNull();
    expect(description.querySelector('script')).toBeNull();
    expect(description.querySelector('svg')).toBeNull();
    expect(description.innerHTML).not.toContain('onclick');
    expect(description.innerHTML).not.toContain('style=');
    expect(description.innerHTML).not.toContain('javascript:');
    expect(description.querySelector('strong')?.textContent).toBe('bold');
    expect(description.querySelector('a')?.getAttribute('href')).toBe('https://example.org/');
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

describe('charity donation amount suggestions', () => {
  async function setupDonationCard(charitySettings: Record<string, unknown> = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CharityDetailComponent],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['npub', 'npub1test']])) } },
        { provide: NostrService, useValue: { clearCharityFeedStatus: jasmine.createSpy('clearCharityFeedStatus') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: Meta, useValue: { updateTag: jasmine.createSpy('updateTag') } },
        { provide: Title, useValue: { setTitle: jasmine.createSpy('setTitle') } }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(CharityDetailComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngOnInit').and.stub();
    component.loading = false;
    component.charity = {
      pubkey: 'a'.repeat(64), npub: 'npub1test', name: 'Donation Charity', about: '',
      picture: '', website: '', lud16: 'donate@example.org', followers: 0,
      ratingAvg: 0, ratingCount: 0, flags: 0, zappedSats: 0, activityLoaded: true,
      charity: { isVisible: true, ...charitySettings }
    } as any;
    fixture.detectChanges();
    return { fixture, component };
  }

  it('starts in EUR with an empty custom amount and the default 10, 20, 50 and 100 suggestions', async () => {
    const { fixture, component } = await setupDonationCard();

    expect(component.donationCurrency).toBe('eur');
    expect(component.donationInput).toBeNull();
    expect(component.suggestedDonationAmounts).toEqual([10, 20, 50, 100]);
    expect(Array.from(fixture.nativeElement.querySelectorAll('.suggested-amount'))
      .map((button: any) => button.textContent.trim())).toEqual(['€10', '€20', '€50', '€100']);
    expect(fixture.nativeElement.querySelector('.suggested-amount.selected')).toBeNull();
    expect((fixture.nativeElement.querySelector('input[name="donationInput"]') as HTMLInputElement).value).toBe('');
    expect(fixture.nativeElement.querySelector('.other-amount-label')?.textContent.trim()).toBe('Custom amount');
    expect(fixture.nativeElement.querySelector('.donation-help')?.textContent.trim())
      .toBe('Pay directly with Lightning, or use a Nostr zap for a publicly verified donation.');
  });

  it('lets the donor select a suggestion and switch the same donation UI to USD', async () => {
    const { fixture, component } = await setupDonationCard();
    const amountButtons = fixture.nativeElement.querySelectorAll('.suggested-amount') as NodeListOf<HTMLButtonElement>;

    amountButtons[1].click();
    fixture.detectChanges();
    expect(component.donationInput).toBe(20);
    expect(amountButtons[1].classList).toContain('selected');
    component.toggleDonationCurrency();
    fixture.detectChanges();
    expect(component.donationCurrency).toBe('usd');
    expect(amountButtons[1].textContent?.trim()).toBe('$20');
  });

  it('uses customized suggestions and lets a charity turn suggestions off', async () => {
    const custom = await setupDonationCard({ suggestedDonationAmounts: [5, 25, 75, 150] });
    expect(custom.component.suggestedDonationAmounts).toEqual([5, 25, 75, 150]);
    expect(custom.fixture.nativeElement.querySelectorAll('.suggested-amount').length).toBe(4);

    const disabled = await setupDonationCard({ suggestedDonationsEnabled: false, suggestedDonationAmounts: [5, 25] });
    expect(disabled.component.suggestedDonationAmounts).toEqual([]);
    expect(disabled.fixture.nativeElement.querySelector('.suggested-amounts')).toBeNull();
  });

  it('converts EUR and USD donor amounts to sats with their respective exchange rate', async () => {
    const { component } = await setupDonationCard();
    component.btcRates = { eur: 50_000, usd: 60_000 };
    component.donationInput = 10;

    expect(component.donationSats).toBe(20_000);
    expect(component.convertedHint).toBe('≈ 20,000 sats');
    component.toggleDonationCurrency();
    expect(component.donationSats).toBe(16_667);
    expect(component.convertedHint).toBe('≈ 16,667 sats');
  });

  it('rejects non-finite, unsafe and excessively large custom amounts', async () => {
    const { component } = await setupDonationCard();
    component.btcRates = { eur: 50_000, usd: 60_000 };

    component.donationInput = Number.POSITIVE_INFINITY;
    expect(component.donationSats).toBe(0);
    expect(component.canDonate).toBeFalse();

    component.donationInput = 1_000_001;
    expect(component.donationSats).toBe(0);
    expect(component.canDonate).toBeFalse();

    component.donationInput = 10;
    component.btcRates.eur = Number.POSITIVE_INFINITY;
    expect(component.donationSats).toBe(0);
    expect(component.canDonate).toBeFalse();
  });
});
