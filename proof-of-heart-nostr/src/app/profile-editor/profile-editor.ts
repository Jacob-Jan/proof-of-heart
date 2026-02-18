import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CharityExtraFields, NostrService } from '../nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
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
    isVisible: true
  };

  private existingModel: CharityExtraFields = {};
  loadingExisting = false;
  needsSignerForLoad = false;

  async ngOnInit() {
    await this.loadExisting();
  }

  async loadExisting() {
    this.loadingExisting = true;
    this.needsSignerForLoad = false;

    try {
      const { pubkey } = await this.nostr.connectSigner();
      const existing = await this.nostr.loadOwnCharityProfile(pubkey);
      if (existing) {
        this.existingModel = existing;
        this.model = { ...existing };
      }
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
