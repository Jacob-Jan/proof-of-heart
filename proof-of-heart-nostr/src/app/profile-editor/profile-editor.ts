import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CharityExtraFields, NostrService } from '../nostr.service';

@Component({
  selector: 'app-profile-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-editor.html',
  styleUrl: './profile-editor.scss'
})
export class ProfileEditorComponent {
  private nostr = inject(NostrService);

  model: CharityExtraFields = {
    mission: '',
    country: '',
    category: '',
    donationMessage: '',
    lightningAddress: ''
  };

  async save() {
    try {
      const id = await this.nostr.publishCharityProfile(this.model);
      alert(`Published charity profile event: ${id}`);
    } catch (e: any) {
      alert(e.message || 'Failed to publish charity profile');
    }
  }
}
