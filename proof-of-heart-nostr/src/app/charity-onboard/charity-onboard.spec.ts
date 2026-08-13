import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CharityOnboardComponent } from './charity-onboard';
import { NostrService } from '../nostr.service';

describe('CharityOnboardComponent', () => {
  let nostr: jasmine.SpyObj<NostrService>;
  let router: jasmine.SpyObj<Router>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  const originalNavigator = window.navigator;

  beforeEach(async () => {
    nostr = jasmine.createSpyObj<NostrService>('NostrService', [
      'connectSigner',
      'startNip46Pairing',
      'waitForNip46Pairing',
      'markLocalOnboarding',
      'ensureCharityProfile'
    ]);
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
    snack = jasmine.createSpyObj<MatSnackBar>('MatSnackBar', ['open']);

    await TestBed.configureTestingModule({
      imports: [CharityOnboardComponent],
      providers: [
        { provide: NostrService, useValue: nostr },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snack }
      ]
    }).compileComponents();
  });

  afterEach(() => {
    Object.defineProperty(window, 'navigator', { value: originalNavigator, configurable: true });
  });

  function setAndroidUserAgent(): void {
    Object.defineProperty(window, 'navigator', {
      value: { ...originalNavigator, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36' },
      configurable: true
    });
  }

  it('opens native Android signer pairing from the charity connect tap when no browser signer is injected', async () => {
    setAndroidUserAgent();
    nostr.connectSigner.and.rejectWith(new Error('No signer found.'));
    nostr.startNip46Pairing.and.returnValue({
      url: 'nostrconnect://client-pubkey?relay=wss%3A%2F%2Frelay.example&secret=abc',
      clientPubkey: 'client-pubkey',
      relays: ['wss://relay.example']
    });
    nostr.waitForNip46Pairing.and.resolveTo({ pubkey: 'a'.repeat(64), npub: 'npub1charity' });
    nostr.ensureCharityProfile.and.resolveTo(undefined as any);
    router.navigate.and.resolveTo(true);

    const fixture = TestBed.createComponent(CharityOnboardComponent);
    const component = fixture.componentInstance;
    component.charityConfirmed = true;
    spyOn(component as any, 'launchExternalUri').and.returnValue(true);

    await component.continueToProfile();

    expect(nostr.startNip46Pairing).toHaveBeenCalled();
    expect((component as any).launchExternalUri).toHaveBeenCalledOnceWith('nostrconnect://client-pubkey?relay=wss%3A%2F%2Frelay.example&secret=abc');
    expect(nostr.waitForNip46Pairing).toHaveBeenCalled();
    expect(nostr.markLocalOnboarding).toHaveBeenCalledWith('a'.repeat(64));
    expect(nostr.ensureCharityProfile).toHaveBeenCalledWith('a'.repeat(64));
    expect(router.navigate).toHaveBeenCalledWith(['/charities', 'npub1charity']);
  });
});
