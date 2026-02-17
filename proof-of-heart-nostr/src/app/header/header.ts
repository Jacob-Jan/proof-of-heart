import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { NostrService } from '../nostr.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class HeaderComponent {
  private nostr = inject(NostrService);
  connected = false;
  npub = '';

  async connect() {
    try {
      const { npub } = await this.nostr.connectSigner();
      this.npub = npub;
      this.connected = true;
    } catch (e: any) {
      alert(e.message || 'Failed to connect Nostr signer');
    }
  }

  get shortNpub() {
    return this.npub ? this.npub.slice(0, 12) + '…' + this.npub.slice(-4) : '';
  }
}
