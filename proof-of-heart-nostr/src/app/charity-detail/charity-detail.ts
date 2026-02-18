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
  donating = false;
  donationStatus = '';
  lastInvoice = '';
  showQrModal = false;
  qrDataUrl = '';
  readonly isLikelyMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

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

  get donationSats(): number {
    if (!this.donationInput || this.donationInput <= 0) return 0;
    if (this.donationMode === 'sats') return Math.round(this.donationInput);
    if (!this.btcUsdRate || this.btcUsdRate <= 0) return 0;
    const btc = this.donationInput / this.btcUsdRate;
    return Math.round(btc * 100_000_000);
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

  async donate() {
    if (!this.charity) return;

    const sats = this.donationSats;
    if (!sats || sats <= 0) {
      alert('Enter a valid donation amount.');
      return;
    }

    const lightningAddress = (this.charity.charity.lightningAddress || this.charity.lud16 || '').trim();
    if (!lightningAddress.includes('@')) {
      alert('No valid lightning address found for this charity.');
      return;
    }

    this.donating = true;
    this.donationStatus = '';

    try {
      const invoice = await this.createZapInvoice(lightningAddress, sats);
      this.lastInvoice = invoice;
      await this.generateQr(invoice);
      this.donationStatus = 'Invoice created. Opening your wallet…';
      window.location.href = `lightning:${invoice}`;
      if (!this.isLikelyMobile) {
        this.showQrModal = true;
      }
    } catch (e: any) {
      this.donationStatus = e?.message || 'Could not create invoice.';
    } finally {
      this.donating = false;
    }
  }

  async copyInvoice() {
    if (!this.lastInvoice) return;
    try {
      await navigator.clipboard.writeText(this.lastInvoice);
      this.donationStatus = 'Invoice copied to clipboard.';
    } catch {
      this.donationStatus = 'Could not copy invoice from browser context.';
    }
  }

  openQrModal() {
    if (!this.lastInvoice) return;
    this.showQrModal = true;
  }

  closeQrModal() {
    this.showQrModal = false;
  }

  private async generateQr(invoice: string) {
    try {
      const QRCode = await import('qrcode');
      this.qrDataUrl = await QRCode.toDataURL(`lightning:${invoice}`, {
        width: 320,
        margin: 1
      });
    } catch {
      this.qrDataUrl = '';
    }
  }

  private async createZapInvoice(lightningAddress: string, sats: number): Promise<string> {
    const [name, domain] = lightningAddress.split('@');
    if (!name || !domain) throw new Error('Invalid lightning address format.');

    const lnurlp = `https://${domain}/.well-known/lnurlp/${name}`;
    const payParamsRes = await fetch(lnurlp);
    const payParams = await payParamsRes.json();

    if (!payParams?.callback) {
      throw new Error('Lightning address does not expose a valid LNURL callback.');
    }

    const amountMsat = sats * 1000;
    if (amountMsat < Number(payParams.minSendable || 0) || amountMsat > Number(payParams.maxSendable || Number.MAX_SAFE_INTEGER)) {
      throw new Error('Amount is outside allowed range for this lightning address.');
    }

    let donorPubkey = this.visitorPubkey;
    if (!donorPubkey && window.nostr) {
      donorPubkey = await window.nostr.getPublicKey();
      this.visitorPubkey = donorPubkey;
    }

    const relays = this.nostr.getActiveRelays();
    const zapRequest = {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['relays', ...relays],
        ['amount', String(amountMsat)],
        ['p', this.charity!.pubkey]
      ]
    } as any;

    if (donorPubkey && window.nostr) {
      const signedZap = await window.nostr.signEvent(zapRequest);
      const callbackUrl = new URL(payParams.callback);
      callbackUrl.searchParams.set('amount', String(amountMsat));
      callbackUrl.searchParams.set('nostr', JSON.stringify(signedZap));

      const zapInvoiceRes = await fetch(callbackUrl.toString());
      const zapInvoice = await zapInvoiceRes.json();
      if (zapInvoice?.pr) return zapInvoice.pr;
    }

    const callbackUrl = new URL(payParams.callback);
    callbackUrl.searchParams.set('amount', String(amountMsat));
    const lnurlInvoiceRes = await fetch(callbackUrl.toString());
    const lnurlInvoice = await lnurlInvoiceRes.json();
    if (!lnurlInvoice?.pr) throw new Error('No invoice returned by lightning endpoint.');
    return lnurlInvoice.pr;
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
