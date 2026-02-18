import { Component, inject } from '@angular/core';
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
export class ProfileEditorComponent {
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);

  model: CharityExtraFields = {
    mission: '',
    country: '',
    category: '',
    donationMessage: '',
    lightningAddress: '',
    isVisible: true
  };

  charityConfirmation = false;

  async save() {
    if (!this.charityConfirmation) {
      this.snack.open('Please confirm this npub represents a charity before publishing.', 'Close', { duration: 3500 });
      return;
    }

    try {
      const id = await this.nostr.publishCharityProfile(this.model);
      this.snack.open(`Published charity profile event: ${id.slice(0, 10)}…`, 'Close', { duration: 4500 });
    } catch (e: any) {
      this.snack.open(e.message || 'Failed to publish charity profile', 'Close', { duration: 4500 });
    }
  }
}
