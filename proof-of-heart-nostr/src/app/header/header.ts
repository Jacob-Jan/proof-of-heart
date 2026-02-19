import { Component, OnInit, inject } from '@angular/core';
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
export class HeaderComponent implements OnInit {
  private nostr = inject(NostrService);

  isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  isSignedInCharity = false;

  async ngOnInit(): Promise<void> {
    const pubkey = await this.nostr.getCurrentPubkey();
    this.isSignedInCharity = this.nostr.hasLocalOnboarding(pubkey);
  }

  get charityNavLabel(): string {
    return this.isSignedInCharity ? 'My charity' : 'For charities';
  }

  get charityNavRoute(): string {
    return this.isSignedInCharity ? '/charity/profile' : '/charity/onboard';
  }

  get relayBadgeLabel() {
    const mode = this.nostr.getRelayMode();
    const active = this.nostr.getActiveRelays();

    if (mode === 'test') return `Relay: TEST (${active[0] ?? 'n/a'})`;
    if (mode === 'prod') return `Relay: PROD (${active[0] ?? 'n/a'})`;

    return `Relay: AUTO (${active[0] ?? 'n/a'})`;
  }
}
