import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';
import { buildAndroidSignerZapCallbackUrl, CharityDetailComponent, normalizeCharityWebsiteHref, shouldStartNip46ZapPairingBeforeAndroidFallback } from './charity-detail';
import { NostrService } from '../nostr.service';

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
