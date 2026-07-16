import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { NostrService } from '../nostr.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './header.html',
  styleUrl: './header.scss'
})
export class HeaderComponent implements OnInit, OnDestroy {
  private nostr = inject(NostrService);
  private router = inject(Router);
  private navSub?: Subscription;

  readonly charityFeedStatus$ = this.nostr.charityFeedStatus$;
  isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  isSignedInCharity = false;
  relayMode: 'auto' | 'test' | 'prod' = 'auto';

  async ngOnInit(): Promise<void> {
    this.relayMode = this.nostr.getRelayMode();
    await this.refreshCharityState();

    this.navSub = this.router.events.subscribe(async (event) => {
      if (event instanceof NavigationEnd) {
        await this.refreshCharityState();
      }
    });
  }

  ngOnDestroy(): void {
    this.navSub?.unsubscribe();
  }

  private async refreshCharityState(): Promise<void> {
    const pubkey = await this.nostr.getCurrentPubkey();
    this.isSignedInCharity = this.nostr.hasLocalOnboarding(pubkey);
  }

  get charityNavLabel(): string {
    return this.isSignedInCharity ? 'My charity' : 'For charities';
  }

  get charityNavRoute(): string {
    return this.isSignedInCharity ? '/charity/profile' : '/charity/onboard';
  }

  setRelayMode(mode: 'test' | 'prod'): void {
    const previous = this.nostr.getRelayMode();
    if (previous === mode) return;

    this.nostr.setRelayMode(mode);
    this.relayMode = mode;
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }

  get relayBadgeLabel() {
    const mode = this.nostr.getRelayMode();
    const active = this.nostr.getActiveRelays();
    const count = active.length;
    const relayWord = count === 1 ? 'relay' : 'relays';

    if (mode === 'test') return `Relay: LOCAL (${count} ${relayWord})`;
    if (mode === 'prod') return `Relay: PROD (${count} ${relayWord})`;

    return `Relay: AUTO (${count} ${relayWord})`;
  }
}
