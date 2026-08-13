import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NostrService } from '../nostr.service';
import { MatButtonModule, MatAnchor } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-charity-onboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCheckboxModule, MatAnchor, MatProgressSpinnerModule],
  templateUrl: './charity-onboard.html',
  styleUrl: './charity-onboard.scss'
})
export class CharityOnboardComponent {
  private nostr = inject(NostrService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  charityConfirmed = false;
  loading = false;
  status = '';

  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }

  async continueToProfile() {
    if (!this.charityConfirmed) {
      this.toast('Please confirm this npub belongs to a charity first.', 'error');
      return;
    }

    if (this.loading) return;
    this.loading = true;
    this.status = 'Connecting to your Nostr signer… approve Proof of Heart if your signer asks.';
    try {
      const { pubkey, npub } = await this.nostr.connectSigner();
      this.status = 'Signer connected. Publishing or verifying the charity profile on relays…';
      this.nostr.markLocalOnboarding(pubkey);
      await this.nostr.ensureCharityProfile(pubkey);
      this.status = 'Profile ready. Opening your public charity profile…';
      this.toast('Connected. Opening your public charity profile…', 'success', 2600);
      await this.router.navigate(['/charities', npub]);
    } catch (e: any) {
      this.status = e?.message || 'Failed to connect Nostr signer.';
      this.toast(e?.message || 'Failed to connect Nostr signer', 'error', 4000);
    } finally {
      this.loading = false;
    }
  }
}
