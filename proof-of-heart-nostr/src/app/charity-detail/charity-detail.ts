import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CharityProfile, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-charity-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './charity-detail.html',
  styleUrl: './charity-detail.scss'
})
export class CharityDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private nostr = inject(NostrService);
  charity?: CharityProfile;
  loading = true;
  rating = 5;
  ratingNote = '';
  reportReason: 'spam' | 'impersonation' | 'scam' = 'scam';
  reportNote = '';
  visitorPubkey = '';
  canEdit = false;

  donationMode: 'sats' | 'usd' = 'sats';
  donationInput = 1000;
  btcUsdRate = 0;

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('pubkey') || '';

    let resolvedPubkey = idParam;
    if (idParam.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(idParam);
        if (decoded.type === 'npub') {
          resolvedPubkey = decoded.data;
        }
      } catch {
        resolvedPubkey = idParam;
      }
    }

    const all = await this.nostr.loadCharities(200);
    this.charity = all.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);

    try {
      if (window.nostr) {
        this.visitorPubkey = await window.nostr.getPublicKey();
      }
    } catch {
      this.visitorPubkey = '';
    }

    this.canEdit = !!this.charity && !!this.visitorPubkey && this.charity.pubkey === this.visitorPubkey;

    await this.loadBtcUsdRate();
    this.loading = false;
  }

  async rate() {
    if (!this.charity) return;
    await this.nostr.publishRating(this.charity.pubkey, this.rating, this.ratingNote);
    alert('Rating published to Nostr.');
  }

  async report() {
    if (!this.charity) return;
    await this.nostr.publishReport(this.charity.pubkey, this.reportReason, this.reportNote);
    alert('Report published to Nostr.');
  }

  toggleDonationMode() {
    this.donationMode = this.donationMode === 'sats' ? 'usd' : 'sats';
  }

  get convertedHint(): string {
    if (!this.btcUsdRate || !this.donationInput || this.donationInput <= 0) {
      return this.donationMode === 'sats' ? '≈ $0.00' : '≈ 0 sats';
    }

    if (this.donationMode === 'sats') {
      const btc = this.donationInput / 100_000_000;
      const usd = btc * this.btcUsdRate;
      return `≈ $${usd.toFixed(2)}`;
    }

    const btc = this.donationInput / this.btcUsdRate;
    const sats = Math.round(btc * 100_000_000);
    return `≈ ${sats.toLocaleString()} sats`;
  }

  private async loadBtcUsdRate() {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      const data = await res.json();
      this.btcUsdRate = Number(data?.bitcoin?.usd) || 0;
    } catch {
      this.btcUsdRate = 0;
    }
  }
}
