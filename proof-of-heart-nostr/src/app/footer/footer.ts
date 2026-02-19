import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';
import { Subscription } from 'rxjs';
import { NostrService } from '../nostr.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterModule],
  templateUrl: './footer.html',
  styleUrl: './footer.scss'
})
export class FooterComponent implements OnInit, OnDestroy {
  currentYear = new Date().getFullYear();

  private nostr = inject(NostrService);
  private router = inject(Router);
  private navSub?: Subscription;

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
}
