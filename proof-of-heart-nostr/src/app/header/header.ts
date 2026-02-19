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

  isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  isSignedInCharity = false;

  async ngOnInit(): Promise<void> {
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

  get relayBadgeLabel() {
    const mode = this.nostr.getRelayMode();
    const active = this.nostr.getActiveRelays();

    if (mode === 'test') return `Relay: TEST (${active[0] ?? 'n/a'})`;
    if (mode === 'prod') return `Relay: PROD (${active[0] ?? 'n/a'})`;

    return `Relay: AUTO (${active[0] ?? 'n/a'})`;
  }
}
