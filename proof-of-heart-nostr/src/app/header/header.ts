import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { NostrService } from '../nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class HeaderComponent {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3000) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
  private nostr = inject(NostrService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  connected = false;
  npub = '';

  isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  get relayBadgeLabel() {
    const mode = this.nostr.getRelayMode();
    const active = this.nostr.getActiveRelays();

    if (mode === 'test') return `Relay: TEST (${active[0] ?? 'n/a'})`;
    if (mode === 'prod') return `Relay: PROD (${active[0] ?? 'n/a'})`;

    return `Relay: AUTO (${active[0] ?? 'n/a'})`;
  }

  async connect() {
    try {
      const { npub } = await this.nostr.connectSigner();
      this.npub = npub;
      this.connected = true;
      this.toast('Nostr signer connected', 'success', 2500);
    } catch (e: any) {
      this.toast(e.message || 'Failed to connect Nostr signer', 'error', 4000);
    }
  }

  async goForCharities(event?: Event) {
    event?.preventDefault();
    try {
      const { pubkey, npub } = await this.nostr.connectSigner();
      this.npub = npub;
      this.connected = true;
      await this.nostr.ensureCharityProfile(pubkey);
      this.toast('Connected. Opening your public charity profile…', 'success', 2800);
      await this.router.navigate(['/charities', npub]);
    } catch (e: any) {
      this.toast(e.message || 'Failed to connect Nostr signer', 'error', 4000);
    }
  }

  get shortNpub() {
    return this.npub ? this.npub.slice(0, 12) + '…' + this.npub.slice(-4) : '';
  }
}
