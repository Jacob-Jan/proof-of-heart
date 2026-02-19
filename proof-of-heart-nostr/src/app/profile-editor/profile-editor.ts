import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CharityExtraFields, NostrService } from '../nostr.service';
import { CHARITY_CATEGORIES, COUNTRIES } from './reference-data';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatCheckboxModule],
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
    shortDescription: '',
    description: '',
    isVisible: true
  };

  kind0Name = '';
  kind0About = '';

  private existingModel: CharityExtraFields = {};
  loadingExisting = false;
  needsSignerForLoad = false;
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

      this.ownNpub = npub;

      const [existing, kind0] = await Promise.all([
        this.nostr.loadOwnCharityProfile(pubkey),
        this.nostr.loadKind0Profile(pubkey)
      ]);

      this.kind0Name = (
        kind0?.['display_name'] ||
        kind0?.['displayName'] ||
        kind0?.['name'] ||
        kind0?.['username'] ||
        ''
      ).trim();
      this.kind0About = (kind0?.['about'] || '').trim();

      if (existing) {
        this.existingModel = existing;
        this.model = { ...existing };
      }

      if (!this.model.shortDescription) this.model.shortDescription = this.kind0About;
      if (!this.model.description) this.model.description = '';
      if (this.model.isVisible === undefined) this.model.isVisible = true;
    } catch {
      this.needsSignerForLoad = true;
    } finally {
      this.loadingExisting = false;
    }
  }

  async save() {
    try {
      const payload: CharityExtraFields = {
        ...this.existingModel,
        ...this.model,
        isVisible: this.model.isVisible ?? this.existingModel.isVisible ?? true
      };

      const id = await this.nostr.publishCharityProfile(payload);
      this.existingModel = { ...payload };
      this.model = { ...payload };
      this.toast(`Published charity profile event: ${id.slice(0, 10)}…`, 'success', 4500);
    } catch (e: any) {
      this.toast(e.message || 'Failed to publish charity profile', 'error', 4500);
    }
  }

  async disconnect() {
    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm('Disconnect this charity account on this device?');

    if (!confirmed) return;

    const pubkey = await this.nostr.getCurrentPubkey();
    this.nostr.disconnectCurrentSession(pubkey);
    this.toast('Disconnected. You can connect a different signer anytime.', 'info', 3500);
    await this.router.navigate(['/onboard']);
  }
}
