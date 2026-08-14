import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NostrService, CharityProfile } from '../nostr.service';
import { nip19 } from 'nostr-tools';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

const ADMIN_NPUB = 'npub1rqu7t9t8rhs2lr9c5gtl92jhnwuyc9996m6s43rxaauxwmkffvks0helr0';

@Component({
  selector: 'app-admin-insights',
  standalone: true,
  imports: [CommonModule, RouterModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './admin-insights.html',
  styleUrl: './admin-insights.scss'
})
export class AdminInsightsComponent implements OnInit {
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);

  loading = false;
  checkingAccess = true;
  status = 'Checking signer access…';
  connectedNpub = '';
  isAuthorized = false;

  totalCharities = 0;
  visibleCharities = 0;
  hiddenCharities = 0;
  totalFollowers = 0;
  totalFlags = 0;
  totalRatings = 0;
  totalZappedSats = 0;

  topByZaps: CharityProfile[] = [];
  topByFollowers: CharityProfile[] = [];
  flaggedCharities: CharityProfile[] = [];

  async ngOnInit() {
    await this.tryAutoCheckAccess();
  }

  async connectAndUnlock() {
    if (this.checkingAccess || this.loading) return;
    this.checkingAccess = true;
    this.status = 'Connecting owner signer… approve Proof of Heart if your signer asks.';
    try {
      const { npub } = await this.nostr.connectSigner();
      this.connectedNpub = npub;
      this.isAuthorized = npub === ADMIN_NPUB;

      if (!this.isAuthorized) {
        this.status = 'Connected signer is not allowed for /admin.';
        this.toast('Connected signer is not allowed for /admin', 'error');
        return;
      }

      this.status = 'Admin access granted. Loading charity insights from Nostr relays…';
      this.toast('Admin access granted', 'success');
      await this.loadInsights();
    } catch (e: any) {
      this.status = e?.message || 'Failed to connect signer.';
      this.toast(e?.message || 'Failed to connect signer', 'error');
    } finally {
      this.checkingAccess = false;
    }
  }

  async reload() {
    if (!this.isAuthorized) return;
    await this.loadInsights();
  }

  private async tryAutoCheckAccess() {
    try {
      if (!window.nostr) {
        this.status = '';
        this.checkingAccess = false;
        return;
      }
      const pubkey = await window.nostr.getPublicKey();
      const npub = nip19.npubEncode(pubkey);
      this.connectedNpub = npub;
      this.isAuthorized = npub === ADMIN_NPUB;

      if (this.isAuthorized) {
        this.status = 'Owner signer detected. Loading charity insights from Nostr relays…';
        await this.loadInsights();
      } else {
        this.status = '';
      }
    } catch {
      // silent: user can manually connect
    } finally {
      this.checkingAccess = false;
    }
  }

  private async loadInsights() {
    this.loading = true;
    this.status = 'Loading charity insights from Nostr relays… this can take a moment.';
    try {
      const charities = await this.nostr.loadCharities(600);

      this.totalCharities = charities.length;
      this.visibleCharities = charities.filter(c => c.charity.isVisible !== false && !c.hidden).length;
      this.hiddenCharities = charities.filter(c => c.hidden || c.charity.isVisible === false).length;
      this.totalFollowers = charities.reduce((sum, c) => sum + c.followers, 0);
      this.totalFlags = charities.reduce((sum, c) => sum + c.flags, 0);
      this.totalRatings = charities.reduce((sum, c) => sum + c.ratingCount, 0);
      this.totalZappedSats = charities.reduce((sum, c) => sum + c.zappedSats, 0);

      this.topByZaps = [...charities]
        .sort((a, b) => b.zappedSats - a.zappedSats)
        .slice(0, 8);

      this.topByFollowers = [...charities]
        .sort((a, b) => b.followers - a.followers)
        .slice(0, 8);

      this.flaggedCharities = [...charities]
        .filter(c => c.flags > 0)
        .sort((a, b) => b.flags - a.flags)
        .slice(0, 8);
      this.status = 'Admin insights refreshed.';
    } catch (e: any) {
      this.status = e?.message || 'Failed to load admin insights.';
      this.toast(e?.message || 'Failed to load admin insights', 'error');
    } finally {
      this.loading = false;
    }
  }

  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
}
