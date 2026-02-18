import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CharityExtraFields, NostrService } from '../nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile-editor.html',
  styleUrl: './profile-editor.scss'
})
export class ProfileEditorComponent implements OnInit {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);

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

  async ngOnInit() {
    await this.loadExisting();
  }

  async loadExisting() {
    this.loadingExisting = true;
    this.needsSignerForLoad = false;

    try {
      const { pubkey, npub } = await this.nostr.connectSigner();
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
}
