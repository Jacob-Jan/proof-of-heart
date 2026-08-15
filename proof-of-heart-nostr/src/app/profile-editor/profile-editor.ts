import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CharityExtraFields, hasCharityProfileChanges, Kind0ProfileEdits, NostrService } from '../nostr.service';
import { CHARITY_CATEGORIES, COUNTRIES } from './reference-data';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatAnchor } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCheckboxModule, MatAnchor, MatProgressSpinnerModule],
  templateUrl: './profile-editor.html',
  styleUrl: './profile-editor.scss'
})
export class ProfileEditorComponent implements OnInit {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);
  private router = inject(Router);

  model: CharityExtraFields = {
    description: '',
    isVisible: true
  };

  kind0Name = '';
  kind0About = '';
  kind0Picture = '';
  kind0Lud16 = '';

  private existingModel: CharityExtraFields = {};
  private existingKind0Metadata: Record<string, any> = {};
  loadingExisting = false;
  saving = false;
  uploadingLogo = false;
  needsSignerForLoad = false;
  loadStatus = '';
  saveStatus = '';
  uploadStatus = '';
  profileFreshForSave = false;
  disconnecting = false;
  ownPubkey: string | null = null;
  ownNpub: string | null = null;
  readonly categories = CHARITY_CATEGORIES;
  readonly countries = COUNTRIES;
  @ViewChild('descriptionEditor') descriptionEditor?: ElementRef<HTMLElement>;
  descriptionEditorHtml = '';

  async ngOnInit() {
    const hasSigner = await this.nostr.hasSigner();
    if (!hasSigner) {
      await this.router.navigate(['/onboard']);
      return;
    }

    await this.loadExisting();
  }

  async loadExisting() {
    this.loadingExisting = true;
    this.profileFreshForSave = false;
    this.needsSignerForLoad = false;
    this.loadStatus = 'Connecting to your signer and loading existing profile data…';

    let loadedCacheOnly = false;

    try {
      const { pubkey, npub } = await this.nostr.connectSigner();

      if (!this.nostr.hasLocalOnboarding(pubkey)) {
        this.toast('This charity account is disconnected on this device. Connect again from onboarding.', 'info', 4500);
        await this.router.navigate(['/onboard']);
        return;
      }

      this.ownPubkey = pubkey;
      this.ownNpub = npub;

      const cached = this.nostr.getCachedEditableCharityProfile(pubkey);
      if (cached) {
        loadedCacheOnly = true;
        this.applyLoadedProfile(cached.fields, cached.kind0);
        this.loadingExisting = false;
        this.loadStatus = 'Showing saved profile details. Refreshing latest relay events…';
      } else {
        this.loadStatus = 'Signer connected. Fetching profile events from Nostr relays…';
      }

      const [existing, kind0] = await Promise.all([
        this.nostr.loadOwnCharityProfile(pubkey),
        this.nostr.loadKind0Profile(pubkey)
      ]);

      const relayKind0 = kind0 || {};
      const relayHasKind0 = Object.keys(relayKind0).length > 0;
      this.applyLoadedProfile(
        existing || cached?.fields || null,
        relayHasKind0 ? relayKind0 : (cached?.kind0 || {})
      );
      // Cached values are only a visual bootstrap. To avoid overwriting newer app-profile
      // changes from elsewhere, require the Proof-of-Heart charity event to be confirmed
      // from relays before saving when cache existed. Do not require a kind:0 hit here:
      // new or under-indexed Nostr accounts may not have a discoverable Primal/NIP-65
      // relay footprint yet, and saving kind:0 already merges the latest metadata we found.
      this.profileFreshForSave = !cached || !!existing;
      loadedCacheOnly = !this.profileFreshForSave;
      this.loadStatus = this.profileFreshForSave
        ? ''
        : 'Showing cached charity details only. Refresh from app relays before saving to avoid overwriting newer changes.';
    } catch {
      if (loadedCacheOnly) {
        this.needsSignerForLoad = false;
        this.loadStatus = 'Showing cached profile details only. Refresh from relays before saving to avoid overwriting newer changes.';
      } else {
        this.needsSignerForLoad = true;
        this.loadStatus = 'Could not load profile data yet. Connect your signer and try again.';
      }
    } finally {
      this.loadingExisting = false;
    }
  }

  private applyLoadedProfile(existing: CharityExtraFields | null, kind0: Record<string, any>) {
    this.existingKind0Metadata = { ...(kind0 || {}) };
    this.kind0Name = (
      kind0?.['display_name'] ||
      kind0?.['displayName'] ||
      kind0?.['name'] ||
      kind0?.['username'] ||
      ''
    ).trim();
    this.kind0About = (kind0?.['about'] || '').trim();
    this.kind0Picture = (kind0?.['picture'] || '').trim();
    this.kind0Lud16 = (kind0?.['lud16'] || '').trim();

    if (existing) {
      this.existingModel = existing;
      this.model = { ...existing };
    }

    if (!this.kind0Lud16 && this.model.lightningAddress) {
      this.kind0Lud16 = this.model.lightningAddress.trim();
    }

    if (!this.model.description) this.model.description = '';
    if (this.model.isVisible === undefined) this.model.isVisible = true;
    this.syncDescriptionEditorFromModel();
  }

  private syncDescriptionEditorFromModel() {
    const description = this.model.description || '';
    this.descriptionEditorHtml = this.descriptionToEditorHtml(description);
  }

  onDescriptionEditorInput(event: Event) {
    const editor = event.target as HTMLElement;
    const html = this.sanitizeDescriptionHtml(editor.innerHTML || '');
    this.model.description = this.emptyHtmlToBlank(html);
  }

  formatDescription(command: 'bold' | 'italic' | 'insertUnorderedList' | 'insertOrderedList' | 'formatBlock', value?: string) {
    this.focusDescriptionEditor();
    document.execCommand(command, false, value);
    const editor = this.descriptionEditor?.nativeElement;
    if (editor) {
      const html = this.sanitizeDescriptionHtml(editor.innerHTML || '');
      editor.innerHTML = html;
      this.descriptionEditorHtml = html;
      this.model.description = this.emptyHtmlToBlank(html);
    }
  }

  addDescriptionLink() {
    this.focusDescriptionEditor();
    const url = window.prompt('Paste a link URL');
    if (!url) return;
    const safeUrl = this.safeUrl(url);
    if (!safeUrl) {
      this.toast('Use an http or https link.', 'error', 3500);
      return;
    }
    document.execCommand('createLink', false, safeUrl);
    const editor = this.descriptionEditor?.nativeElement;
    if (editor) {
      const html = this.sanitizeDescriptionHtml(editor.innerHTML || '');
      editor.innerHTML = html;
      this.descriptionEditorHtml = html;
      this.model.description = this.emptyHtmlToBlank(html);
    }
  }

  private focusDescriptionEditor() {
    this.descriptionEditor?.nativeElement.focus();
  }

  private looksLikeHtml(value: string): boolean {
    return /<\/?(p|br|strong|b|em|i|ul|ol|li|h2|h3|blockquote|a)\b/i.test(value || '');
  }

  private descriptionToEditorHtml(value: string): string {
    if (!value) return '';
    return this.looksLikeHtml(value) ? this.sanitizeDescriptionHtml(value) : this.plainTextToHtml(value);
  }

  private plainTextToHtml(value: string): string {
    const escaped = this.escapeHtml(value.trim());
    if (!escaped) return '';
    return escaped
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  private sanitizeDescriptionHtml(value: string): string {
    const allowedTags = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'UL', 'OL', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'A']);
    const doc = new DOMParser().parseFromString(value || '', 'text/html');
    doc.body.querySelectorAll('*').forEach((el) => {
      if (!allowedTags.has(el.tagName)) {
        el.replaceWith(...Array.from(el.childNodes));
        return;
      }
      const originalHref = el.getAttribute('href') || '';
      Array.from(el.attributes).forEach((attr) => el.removeAttribute(attr.name));
      if (el.tagName === 'A') {
        const href = this.safeUrl(originalHref);
        if (href) {
          el.setAttribute('href', href);
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        } else {
          el.replaceWith(...Array.from(el.childNodes));
        }
      }
    });
    return this.emptyHtmlToBlank(doc.body.innerHTML);
  }

  private emptyHtmlToBlank(value: string): string {
    const normalized = (value || '').replace(/<p><br><\/p>/gi, '').replace(/&nbsp;/gi, ' ').trim();
    return normalized && normalized !== '<br>' ? normalized : '';
  }

  private safeUrl(value: string): string {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
    } catch {
      return '';
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async uploadLogo(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadingLogo) return;

    this.uploadingLogo = true;
    this.uploadStatus = 'Preparing image upload… approve the upload event in your signer if prompted.';
    try {
      this.toast('Approve image upload in your signer…', 'info', 5000);
      this.uploadStatus = 'Uploading logo to Blossom storage. This can take up to a minute…';
      const uploaded = await this.nostr.uploadProfileImageToBlossom(file);
      this.kind0Picture = uploaded.url;
      this.uploadStatus = '';
      this.toast('Logo uploaded. Save profile to publish it.', 'success', 4500);
    } catch (e: any) {
      console.error('[PoH] profile-editor:logo-upload-failed', e);
      this.uploadStatus = e?.message || 'Logo upload failed.';
      this.toast(e?.message || 'Logo upload failed', 'error', 5000);
    } finally {
      this.uploadingLogo = false;
    }
  }

  async save() {
    if (this.saving) return;
    if (!this.profileFreshForSave) {
      this.toast('Still refreshing latest relay profile. Please wait before saving so newer changes are not overwritten.', 'info', 4500);
      this.saveStatus = 'Waiting for latest relay profile before saving…';
      return;
    }
    this.saving = true;
    this.saveStatus = 'Preparing profile changes…';

    try {
      const editorHtml = this.descriptionEditor?.nativeElement.innerHTML || this.descriptionEditorHtml || '';
      this.model.description = this.emptyHtmlToBlank(this.sanitizeDescriptionHtml(editorHtml));

      const kind0Payload: Kind0ProfileEdits = {
        name: this.kind0Name,
        about: this.kind0About,
        picture: this.kind0Picture,
        lud16: this.kind0Lud16
      };
      const payload: CharityExtraFields = {
        ...this.existingModel,
        ...this.model,
        isVisible: this.model.isVisible ?? this.existingModel.isVisible ?? true
      };
      // Keep legacy app-specific fields cleared; Nostr bio and Lightning address now live in kind 0.
      payload.shortDescription = '';
      delete payload.lightningAddress;

      this.toast('Waiting for signer approval… check your signer.', 'info', 5000);
      let kind0Id = '';
      let charityProfileId = '';
      if (this.hasKind0Changes(kind0Payload)) {
        this.saveStatus = 'Approve the Nostr public profile event in your signer, then wait for relay acknowledgements…';
        const publishedKind0 = await this.nostr.publishKind0Profile(this.existingKind0Metadata, kind0Payload);
        kind0Id = publishedKind0.id;
        this.existingKind0Metadata = publishedKind0.metadata;
      }

      if (hasCharityProfileChanges(this.existingModel, payload)) {
        this.saveStatus = 'Approve the Proof of Heart charity profile event in your signer, then wait for relay acknowledgements…';
        charityProfileId = await this.nostr.publishCharityProfile(payload);
        this.existingModel = { ...payload };
        this.model = { ...payload };
      }

      if (this.ownPubkey) {
        this.nostr.refreshCharityProfileCache(this.ownPubkey, payload, this.existingKind0Metadata);
      }
      this.saveStatus = '';
      this.toast(this.saveSuccessMessage(kind0Id, charityProfileId), 'success', 4500);
    } catch (e: any) {
      console.error('[PoH] profile-editor:save-failed', e);
      this.saveStatus = e?.message || 'Failed to publish charity profile.';
      this.toast(e?.message || 'Failed to publish charity profile', 'error', 4500);
    } finally {
      this.saving = false;
    }
  }

  private hasKind0Changes(next: Kind0ProfileEdits): boolean {
    const normalize = (value: any) => (typeof value === 'string' ? value.trim() : '');
    const currentName = normalize(this.existingKind0Metadata['display_name'] || this.existingKind0Metadata['displayName'] || this.existingKind0Metadata['name'] || this.existingKind0Metadata['username']);
    return normalize(next.name) !== currentName
      || normalize(next.about) !== normalize(this.existingKind0Metadata['about'])
      || normalize(next.picture) !== normalize(this.existingKind0Metadata['picture'])
      || normalize(next.lud16) !== normalize(this.existingKind0Metadata['lud16']);
  }

  private saveSuccessMessage(kind0Id: string, charityProfileId: string): string {
    if (kind0Id && charityProfileId) return 'Published Nostr profile and charity profile events.';
    if (kind0Id) return 'Published Nostr profile.';
    if (charityProfileId) return `Published charity profile event: ${charityProfileId.slice(0, 10)}…`;
    return 'No profile changes to publish.';
  }

  async disconnect() {
    if (this.disconnecting) return;

    this.disconnecting = true;
    this.saveStatus = 'Signing out…';
    try {
      const pubkey = await this.nostr.getCurrentPubkey();
      this.nostr.disconnectCurrentSession(pubkey);
      this.toast('Signed out.', 'info', 3500);
      await this.router.navigate(['/']);
    } finally {
      this.disconnecting = false;
      this.saveStatus = '';
    }
  }
}
