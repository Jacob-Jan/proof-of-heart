import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CharityOnboardComponent } from './charity-onboard';
import { NostrService } from '../nostr.service';

describe('CharityOnboardComponent', () => {
  function setup(nostrOverrides: Partial<NostrService> = {}) {
    const nostr = {
      hasNip07Signer: jasmine.createSpy('hasNip07Signer').and.returnValue(false),
      hasNip46Session: jasmine.createSpy('hasNip46Session').and.returnValue(false),
      connectSigner: jasmine.createSpy('connectSigner'),
      startNip46Pairing: jasmine.createSpy('startNip46Pairing').and.returnValue({
        url: 'nostrconnect://client?relay=wss%3A%2F%2Frelay.example&secret=pairing-secret',
        clientPubkey: '2'.repeat(64),
        relays: ['wss://relay.example']
      }),
      waitForNip46Pairing: jasmine.createSpy('waitForNip46Pairing').and.resolveTo({
        pubkey: '4'.repeat(64),
        npub: 'npub1charity'
      }),
      markLocalOnboarding: jasmine.createSpy('markLocalOnboarding'),
      ensureCharityProfile: jasmine.createSpy('ensureCharityProfile').and.resolveTo(undefined),
      ...nostrOverrides
    };
    const router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    const snack = { open: jasmine.createSpy('open') };

    TestBed.configureTestingModule({
      imports: [CharityOnboardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: NostrService, useValue: nostr },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snack }
      ]
    });

    const fixture = TestBed.createComponent(CharityOnboardComponent);
    const component = fixture.componentInstance;
    spyOn(component as any, 'launchExternalUri').and.returnValue(true);
    return { fixture, component, nostr, router, snack };
  }

  it('starts NIP-46 pairing when charity signup has no NIP-07 signer', async () => {
    const { component, nostr, router } = setup();
    component.charityConfirmed = true;

    await component.continueToProfile();

    expect(nostr.startNip46Pairing).toHaveBeenCalled();
    expect((component as any).launchExternalUri).toHaveBeenCalledWith('nostrconnect://client?relay=wss%3A%2F%2Frelay.example&secret=pairing-secret');
    expect(nostr.waitForNip46Pairing).toHaveBeenCalledWith(120_000);
    expect(nostr.markLocalOnboarding).toHaveBeenCalledWith('4'.repeat(64));
    expect(router.navigate).toHaveBeenCalledWith(['/charities', 'npub1charity']);
  });

  it('uses an existing available signer without starting a new NIP-46 pairing', async () => {
    const { component, nostr, router } = setup({
      hasNip07Signer: jasmine.createSpy('hasNip07Signer').and.returnValue(true),
      connectSigner: jasmine.createSpy('connectSigner').and.resolveTo({ pubkey: '5'.repeat(64), npub: 'npub1existing' })
    } as any);
    component.charityConfirmed = true;

    await component.continueToProfile();

    expect(nostr.connectSigner).toHaveBeenCalled();
    expect(nostr.startNip46Pairing).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/charities', 'npub1existing']);
  });
});
