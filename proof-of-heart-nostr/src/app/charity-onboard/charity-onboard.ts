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
    this.status = 'Connecting…';
    try {
      const { pubkey, npub } = await this.connectForCharityOnboarding();
      this.status = 'Finalizing…';
      this.nostr.markLocalOnboarding(pubkey);
      await this.nostr.ensureCharityProfile(pubkey);
      this.status = 'Profile ready. Opening your charity profile…';
      this.toast('Connected. Opening your charity profile…', 'success', 2600);
      await this.router.navigate(['/charities', npub]);
    } catch (e: any) {
      const message = this.friendlyConnectError(e);
      this.status = message;
      this.toast(message, 'error', 4000);
    } finally {
      this.loading = false;
    }
  }

  private async connectForCharityOnboarding(): Promise<{ pubkey: string; npub: string }> {
    try {
      return await this.nostr.connectSigner();
    } catch (e: any) {
      if (!this.isAndroidBrowser() || !this.isMissingSignerError(e)) throw e;
      return this.connectWithAndroidSigningApp();
    }
  }

  private async connectWithAndroidSigningApp(): Promise<{ pubkey: string; npub: string }> {
    const pairing = this.nostr.startNip46Pairing();
    this.status = 'Opening signer…';
    if (!this.launchExternalUri(pairing.url)) {
      throw new Error('Could not open your signer. Please try again.');
    }
    this.status = 'Waiting for approval…';
    return this.nostr.waitForNip46Pairing();
  }

  private isAndroidBrowser(): boolean {
    return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
  }

  private isMissingSignerError(error: any): boolean {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('no nostr signer') || message.includes('no signer');
  }

  private launchExternalUri(uri: string): boolean {
    try {
      window.location.href = uri;
      return true;
    } catch {
      try {
        const link = document.createElement('a');
        link.href = uri;
        link.target = '_self';
        link.rel = 'noopener';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        window.setTimeout(() => link.remove(), 1_000);
        return true;
      } catch {
        return false;
      }
    }
  }

  private friendlyConnectError(error: any): string {
    if (this.isMissingSignerError(error)) {
      return this.isAndroidBrowser()
        ? 'Could not open your signer. Please try again.'
        : 'No signer found. Please install or pair a Nostr signer.';
    }
    return error?.message || 'Could not connect signer. Please try again.';
  }
}
