import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ProfileEditorComponent } from './profile-editor';
import { NostrService } from '../nostr.service';

describe('ProfileEditorComponent rich description editor', () => {
  async function setup(description = '<p>Existing <strong>HTML</strong></p>') {
    TestBed.resetTestingModule();
    const nostr = {
      hasSigner: jasmine.createSpy('hasSigner').and.resolveTo(true),
      connectSigner: jasmine.createSpy('connectSigner').and.resolveTo({ pubkey: 'a'.repeat(64), npub: 'npub1charity' }),
      hasLocalOnboarding: jasmine.createSpy('hasLocalOnboarding').and.returnValue(true),
      getCachedEditableCharityProfile: jasmine.createSpy('getCachedEditableCharityProfile').and.returnValue(null),
      loadOwnCharityProfile: jasmine.createSpy('loadOwnCharityProfile').and.resolveTo({
        description,
        isVisible: true,
        country: 'El Salvador',
        category: 'Education'
      }),
      loadKind0Profile: jasmine.createSpy('loadKind0Profile').and.resolveTo({
        name: 'HTML Charity',
        about: 'Short bio',
        lud16: 'charity@example.com'
      }),
      publishKind0Profile: jasmine.createSpy('publishKind0Profile').and.resolveTo({ id: 'kind0', metadata: {} }),
      publishCharityProfile: jasmine.createSpy('publishCharityProfile').and.resolveTo('charity-event'),
      refreshCharityProfileCache: jasmine.createSpy('refreshCharityProfileCache'),
      uploadProfileImageToBlossom: jasmine.createSpy('uploadProfileImageToBlossom'),
      getCurrentPubkey: jasmine.createSpy('getCurrentPubkey').and.resolveTo('a'.repeat(64)),
      disconnectCurrentSession: jasmine.createSpy('disconnectCurrentSession')
    };
    const router = {
      navigate: jasmine.createSpy('navigate').and.resolveTo(true),
      createUrlTree: jasmine.createSpy('createUrlTree').and.returnValue({}),
      serializeUrl: jasmine.createSpy('serializeUrl').and.returnValue('/charities/npub1charity'),
      events: { subscribe: jasmine.createSpy('subscribe').and.returnValue({ unsubscribe: jasmine.createSpy('unsubscribe') }) }
    };
    const snack = { open: jasmine.createSpy('open') };
    const dialog = { open: jasmine.createSpy('open') };

    await TestBed.configureTestingModule({
      imports: [ProfileEditorComponent],
      providers: [
        provideNoopAnimations(),
        { provide: NostrService, useValue: nostr },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {} },
        { provide: MatSnackBar, useValue: snack },
        { provide: MatDialog, useValue: dialog }
      ]
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileEditorComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance, nostr, router, snack, dialog };
  }

  it('shows only the rich HTML editor and compact formatting toolbar for charity descriptions', async () => {
    const { fixture } = await setup();

    const toolbar = fixture.nativeElement.querySelector('.description-toolbar') as HTMLElement;
    const editor = fixture.nativeElement.querySelector('.rich-description-editor') as HTMLElement;
    const textarea = fixture.nativeElement.querySelector('textarea[name="description"]') as HTMLTextAreaElement | null;
    const modeToggle = fixture.nativeElement.querySelector('.description-mode-toggle') as HTMLElement | null;

    expect(modeToggle).withContext('plain text mode toggle should be removed').toBeNull();
    expect(toolbar).withContext('description formatting toolbar should be visible').toBeTruthy();
    expect(toolbar.textContent).toContain('Heading');
    expect(toolbar.textContent).toContain('Paragraph');
    expect(toolbar.textContent).toContain('• List');
    expect(toolbar.textContent).not.toContain('Text');
    expect(toolbar.textContent).not.toContain('Clear');
    expect(editor).withContext('contenteditable rich description editor should be visible').toBeTruthy();
    expect(editor.getAttribute('contenteditable')).toBe('true');
    expect(editor.querySelector('strong')?.textContent).toBe('HTML');
    expect(textarea).withContext('plain textarea should not exist for descriptions').toBeNull();
  });

  it('sanitizes rich editor input into the saved description model', async () => {
    const { fixture, component } = await setup('Plain starting text');
    const editor = fixture.nativeElement.querySelector('.rich-description-editor') as HTMLElement;

    editor.innerHTML = '<p>Hello <strong>donors</strong><script>alert(1)</script></p><a href="javascript:alert(1)">bad</a><a href="example.org">good</a>';
    editor.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.model.description).toContain('<strong>donors</strong>');
    expect(component.model.description).not.toContain('<script>');
    expect(component.model.description).not.toContain('javascript:');
    expect(component.model.description).toContain('href="https://example.org/"');
  });

  it('signs out immediately without a confirmation dialog', async () => {
    const { fixture, component, nostr, router, dialog } = await setup();

    const signOutButton = Array.from(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)
      .find((button) => button.textContent?.trim() === 'Sign out');
    expect(signOutButton).withContext('sign-out button should use familiar copy').toBeTruthy();

    await component.disconnect();
    fixture.detectChanges();

    expect(dialog.open).not.toHaveBeenCalled();
    expect(nostr.getCurrentPubkey).toHaveBeenCalled();
    expect(nostr.disconnectCurrentSession).toHaveBeenCalledWith('a'.repeat(64));
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
});
