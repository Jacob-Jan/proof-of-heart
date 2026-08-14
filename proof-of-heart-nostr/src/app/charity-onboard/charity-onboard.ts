import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { NostrService } from '../nostr.service';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-charity-onboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCheckboxModule, MatButtonModule, MatProgressSpinnerModule],
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
  nip46ConnectUrl = '';
  nip46Pairing = false;

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
    this.nip46Pairing = false;
    this.status = 'Connecting to your Nostr signer… approve Proof of Heart if your signer asks.';
    try {
      const signer = await this.connectOnboardingSigner();
      this.status = 'Signer connected. Publishing or verifying the charity profile on relays…';
      this.nostr.markLocalOnboarding(signer.pubkey);
      await this.nostr.ensureCharityProfile(signer.pubkey);
      this.status = 'Profile ready. Opening your public charity profile…';
      this.toast('Connected. Opening your public charity profile…', 'success', 2600);
      await this.router.navigate(['/charities', signer.npub]);
    } catch (e: any) {
      this.status = e?.message || 'Failed to connect Nostr signer.';
      this.toast(e?.message || 'Failed to connect Nostr signer', 'error', 4000);
    } finally {
      this.loading = false;
    }
  }

  openRemoteSigner() {
    if (this.nip46ConnectUrl) this.launchExternalUri(this.nip46ConnectUrl);
  }

  private async connectOnboardingSigner(): Promise<{ pubkey: string; npub: string }> {
    if (this.nostr.hasNip07Signer() || this.nostr.hasNip46Session()) {
      try {
        return await this.nostr.connectSigner();
      } catch {
        // Fall through to a fresh/re-opened NIP-46 pairing below.
      }
    }

    const pairing = this.nostr.startNip46Pairing();
    this.nip46ConnectUrl = pairing.url;
    this.nip46Pairing = true;
    this.status = 'Opening your Nostr remote signer. Approve the Proof of Heart connection there, then return here.';
    this.launchExternalUri(pairing.url);
    const signer = await this.nostr.waitForNip46Pairing(120_000);
    this.nip46Pairing = false;
    return signer;
  }

  private launchExternalUri(uri: string): boolean {
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
      try {
        window.location.href = uri;
        return true;
      } catch {
        return false;
      }
    }
  }
}
