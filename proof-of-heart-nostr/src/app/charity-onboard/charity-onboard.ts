import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NostrService } from '../nostr.service';
import { MatButtonModule, MatAnchor } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

@Component({
  selector: 'app-charity-onboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCheckboxModule, MatAnchor, MatProgressSpinnerModule],
  templateUrl: './charity-onboard.html',
  styleUrl: './charity-onboard.scss'
})
export class CharityOnboardComponent implements OnInit {
  private nostr = inject(NostrService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  charityConfirmed = false;
  loading = false;
  status = '';
  showClipboardConnect = false;

  ngOnInit() {
    const connected = this.nostr.consumeNativeAndroidSignerCallback();
    if (connected) {
      this.status = 'Connected. Finalizing…';
      void this.finishOnboarding(connected.pubkey, connected.npub);
    }
  }

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
    this.showClipboardConnect = false;
    this.status = 'Connecting…';
    try {
      const { pubkey, npub } = isAndroidBrowser() && !this.nostr.hasNip07Signer()
        ? await this.nostr.connectNativeAndroidSigner()
        : await this.nostr.connectSigner();
      this.status = 'Finalizing…';
      await this.finishOnboarding(pubkey, npub);
    } catch (e: any) {
      if (isAndroidBrowser() && !this.nostr.hasNip07Signer()) {
        this.showClipboardConnect = true;
        this.status = 'Tap finish to continue.';
      } else {
        this.status = 'Could not connect. Please try again.';
        this.toast('Could not connect. Please try again.', 'error', 4000);
      }
    } finally {
      this.loading = false;
    }
  }

  async finishFromClipboard() {
    if (this.loading) return;
    this.loading = true;
    this.status = 'Finalizing…';
    try {
      const connected = await this.nostr.connectNativeAndroidSignerFromClipboard();
      if (!connected) throw new Error('No signer result found.');
      this.showClipboardConnect = false;
      await this.finishOnboarding(connected.pubkey, connected.npub);
    } catch {
      this.status = 'Could not connect. Please try again.';
      this.toast('Could not connect. Please try again.', 'error', 4000);
    } finally {
      this.loading = false;
    }
  }

  private async finishOnboarding(pubkey: string, npub: string): Promise<void> {
    this.loading = true;
    this.nostr.markLocalOnboarding(pubkey);
    await this.nostr.ensureCharityProfile(pubkey);
    this.status = 'Opening profile…';
    this.toast('Connected. Opening your public charity profile…', 'success', 2600);
    await this.router.navigate(['/charities', npub]);
  }
}
