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

  isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  get relayBadgeLabel() {
    const mode = this.nostr.getRelayMode();
    const active = this.nostr.getActiveRelays();

    if (mode === 'test') return `Relay: TEST (${active[0] ?? 'n/a'})`;
    if (mode === 'prod') return `Relay: PROD (${active[0] ?? 'n/a'})`;

    return `Relay: AUTO (${active[0] ?? 'n/a'})`;
  }
}
