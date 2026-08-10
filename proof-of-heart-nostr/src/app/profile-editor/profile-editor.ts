import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CharityExtraFields, Kind0ProfileEdits, NostrService } from '../nostr.service';
import { CHARITY_CATEGORIES, COUNTRIES } from './reference-data';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule, MatAnchor } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-disconnect-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Disconnect charity account?</h2>
    <mat-dialog-content>
      This disconnects this charity on this device. You can reconnect anytime from onboarding.
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Cancel</button>
      <button mat-flat-button color="warn" [mat-dialog-close]="true">Disconnect</button>
    </mat-dialog-actions>
  `
})
export class DisconnectConfirmDialogComponent {}

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
  private dialog = inject(MatDialog);

  model: CharityExtraFields = {
    description: '',
    isVisible: true
  };

  kind0Name = '';
  kind0About = '';
  kind0Picture = '';

  private existingModel: CharityExtraFields = {};
  private existingKind0Metadata: Record<string, any> = {};
  loadingExisting = false;
  saving = false;
  uploadingLogo = false;
  needsSignerForLoad = false;
  ownPubkey: string | null = null;
  ownNpub: string | null = null;
  readonly categories = CHARITY_CATEGORIES;
  readonly countries = COUNTRIES;

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
    this.needsSignerForLoad = false;

    try {
      const { pubkey, npub } = await this.nostr.connectSigner();

      if (!this.nostr.hasLocalOnboarding(pubkey)) {
        this.toast('This charity account is disconnected on this device. Connect again from onboarding.', 'info', 4500);
        await this.router.navigate(['/onboard']);
        return;
      }

      this.ownPubkey = pubkey;
      this.ownNpub = npub;

      const [existing, kind0] = await Promise.all([
        this.nostr.loadOwnCharityProfile(pubkey),
        this.nostr.loadKind0Profile(pubkey)
      ]);

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

      if (existing) {
        this.existingModel = existing;
        this.model = { ...existing };
      }

      if (!this.model.description) this.model.description = '';
      if (this.model.isVisible === undefined) this.model.isVisible = true;
    } catch {
      this.needsSignerForLoad = true;
    } finally {
      this.loadingExisting = false;
    }
  }

  async uploadLogo(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.uploadingLogo) return;

    this.uploadingLogo = true;
    try {
      this.toast('Approve image upload in your signer…', 'info', 5000);
      const uploaded = await this.nostr.uploadProfileImageToBlossom(file);
      this.kind0Picture = uploaded.url;
      this.toast('Logo uploaded. Save profile to publish it.', 'success', 4500);
    } catch (e: any) {
      console.error('[PoH] profile-editor:logo-upload-failed', e);
      this.toast(e?.message || 'Logo upload failed', 'error', 5000);
    } finally {
      this.uploadingLogo = false;
    }
  }

  async save() {
    if (this.saving) return;
    this.saving = true;

    try {
      const kind0Payload: Kind0ProfileEdits = {
        name: this.kind0Name,
        about: this.kind0About,
        picture: this.kind0Picture
      };
      const payload: CharityExtraFields = {
        ...this.existingModel,
        ...this.model,
        isVisible: this.model.isVisible ?? this.existingModel.isVisible ?? true
      };
      // Keep legacy app-specific shortDescription cleared; Nostr bio is now the short text.
      payload.shortDescription = '';

      this.toast('Waiting for signer approval… check your extension popup.', 'info', 5000);
      let kind0Id = '';
      if (this.hasKind0Changes(kind0Payload)) {
        const publishedKind0 = await this.nostr.publishKind0Profile(this.existingKind0Metadata, kind0Payload);
        kind0Id = publishedKind0.id;
        this.existingKind0Metadata = publishedKind0.metadata;
      }
      const id = await this.nostr.publishCharityProfile(payload);
      this.existingModel = { ...payload };
      this.model = { ...payload };
      if (this.ownPubkey) {
        this.nostr.refreshCharityProfileCache(this.ownPubkey, payload, this.existingKind0Metadata);
      }
      this.toast(kind0Id
        ? `Published Nostr profile and charity profile events.`
        : `Published charity profile event: ${id.slice(0, 10)}…`, 'success', 4500);
    } catch (e: any) {
      console.error('[PoH] profile-editor:save-failed', e);
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
      || normalize(next.picture) !== normalize(this.existingKind0Metadata['picture']);
  }

  async disconnect() {
    const dialogRef = this.dialog.open(DisconnectConfirmDialogComponent, {
      width: '420px',
      maxWidth: '92vw',
      autoFocus: false
    });

    const confirmed = await firstValueFrom(dialogRef.afterClosed());
    if (!confirmed) return;

    const pubkey = await this.nostr.getCurrentPubkey();
    this.nostr.disconnectCurrentSession(pubkey);
    this.toast('Disconnected. You can connect a different signer anytime.', 'info', 3500);
    await this.router.navigate(['/']);
  }
}
