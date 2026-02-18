import { Component, DOCUMENT, Inject, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CharityProfile, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Meta, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-charity-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule],
  templateUrl: './charity-detail.html',
  styleUrl: './charity-detail.scss'
})
export class CharityDetailComponent implements OnInit, OnDestroy {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }

  private route = inject(ActivatedRoute);
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);
  private title = inject(Title);
  private meta = inject(Meta);
  private jsonLdScriptElement?: HTMLScriptElement;

  constructor(@Inject(DOCUMENT) private doc: Document) {}

  charity?: CharityProfile;
  loading = true;
  currentIdParam = '';

  rating = 5;
  ratingNote = '';
  reportReason: 'spam' | 'impersonation' | 'scam' = 'scam';
  reportNote = '';
  showRateDialog = false;
  showFlagDialog = false;

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

  get donationAddress(): string {
    return (this.charity?.charity.lightningAddress || this.charity?.lud16 || '').trim();
  }

  get canDonate(): boolean {
    return !!this.donationAddress && this.donationAddress.includes('@') && this.donationSats > 0 && !this.donating;
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

  async ngOnInit() {
    this.currentIdParam = this.route.snapshot.paramMap.get('pubkey') || '';

    this.visitorPubkey = await this.nostr.getCurrentPubkey();

    await this.refreshCharity();
    await this.loadBtcUsdRate();
    this.loading = false;
  }

  ngOnDestroy(): void {
    if (this.jsonLdScriptElement) {
      this.doc.head.removeChild(this.jsonLdScriptElement);
      this.jsonLdScriptElement = undefined;
    }
  }

  async refreshCharity() {
    const idParam = this.currentIdParam;

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

    const all = await this.nostr.loadCharities(300);
    this.charity = all.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);
    this.canEdit = !!this.charity && !!this.visitorPubkey && this.charity.pubkey === this.visitorPubkey;

    if (this.charity) {
      this.updateSeo(this.charity);
    } else {
      this.title.setTitle('Charity not found | Proof of Heart');
      this.meta.updateTag({ name: 'description', content: 'This charity profile could not be found on the currently queried relays.' });
      this.setCanonical('https://proofofheart.org/');
    }
  }

  openRateDialog() {
    this.rating = 5;
    this.ratingNote = '';
    this.showRateDialog = true;
  }

  closeRateDialog() {
    this.showRateDialog = false;
  }

  openFlagDialog() {
    this.reportReason = 'scam';
    this.reportNote = '';
    this.showFlagDialog = true;
  }

  closeFlagDialog() {
    this.showFlagDialog = false;
  }

  async rate() {
    if (!this.charity) return;
    try {
      await this.nostr.publishRating(this.charity.pubkey, this.rating, this.ratingNote);
      this.toast('Rating published to Nostr.', 'success', 3000);
      this.closeRateDialog();
      await this.refreshCharity();
    } catch (e: any) {
      this.toast(e?.message || 'Failed to publish rating.', 'error', 4000);
    }
  }

  async report() {
    if (!this.charity) return;
    try {
      await this.nostr.publishReport(this.charity.pubkey, this.reportReason, this.reportNote);
      this.toast('Flag published to Nostr.', 'success', 3000);
      this.closeFlagDialog();
      await this.refreshCharity();
    } catch (e: any) {
      this.toast(e?.message || 'Failed to publish flag.', 'error', 4000);
    }
  }

  toggleDonationMode() {
    this.donationMode = this.donationMode === 'sats' ? 'usd' : 'sats';
  }

  async donate() {
    if (!this.charity) return;

    const sats = this.donationSats;
    if (!sats || sats <= 0) {
      this.toast('Enter a valid donation amount.', 'error', 3000);
      return;
    }

    const lightningAddress = this.donationAddress;
    if (!lightningAddress.includes('@')) {
      this.toast('No valid lightning address found for this charity.', 'error', 3500);
      return;
    }

    this.donating = true;
    this.donationStatus = '';

    try {
      const invoice = await this.createZapInvoice(lightningAddress, sats);
      this.lastInvoice = invoice;
      await this.generateQr(invoice);
      this.donationStatus = 'Invoice created. Opening your wallet…';
      this.toast('Invoice ready. Trying to open your wallet…', 'info', 3000);
      window.location.href = `lightning:${invoice}`;
      if (!this.isLikelyMobile) {
        this.showQrModal = true;
      }
      setTimeout(() => this.refreshCharity(), 4000);
    } catch (e: any) {
      this.donationStatus = e?.message || 'Could not create invoice.';
      this.toast(this.donationStatus, 'error', 4500);
    } finally {
      this.donating = false;
    }
  }

  async copyInvoice() {
    if (!this.lastInvoice) return;
    try {
      await navigator.clipboard.writeText(this.lastInvoice);
      this.donationStatus = 'Invoice copied to clipboard.';
      this.toast('Invoice copied to clipboard.', 'success', 2500);
    } catch {
      this.donationStatus = 'Could not copy invoice from browser context.';
      this.toast(this.donationStatus, 'error', 3500);
    }
  }

  get nostrProfileUri(): string {
    if (!this.charity?.npub) return '';
    return `nostr:${this.charity.npub}`;
  }

  get primalProfileUrl(): string {
    if (!this.charity?.npub) return '';
    return `https://primal.net/p/${this.charity.npub}`;
  }

  get njumpProfileUrl(): string {
    if (!this.charity?.npub) return '';
    return `https://njump.me/${this.charity.npub}`;
  }

  async copyNostrProfileUri() {
    if (!this.nostrProfileUri) return;
    try {
      await navigator.clipboard.writeText(this.nostrProfileUri);
      this.toast('Copied nostr profile link.', 'success', 2400);
    } catch {
      this.toast('Could not copy profile link.', 'error', 3000);
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

  private updateSeo(charity: CharityProfile) {
    const title = `${charity.name} | Donate with Bitcoin on Proof of Heart`;
    const description = (charity.charity.shortDescription || charity.about || charity.charity.mission || `Donate to ${charity.name} with lightning or zaps.`)
      .slice(0, 155);
    const canonical = `https://proofofheart.org/charities/${charity.npub}`;
    const image = charity.picture || 'https://proofofheart.org/assets/logo.png';

    this.title.setTitle(title);
    this.meta.updateTag({ name: 'description', content: description });

    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:title', content: title });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:url', content: canonical });
    this.meta.updateTag({ property: 'og:image', content: image });

    this.meta.updateTag({ name: 'twitter:title', content: title });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.setCanonical(canonical);
    this.setJsonLdForCharity(charity, canonical);
  }

  private setCanonical(url: string) {
    let link: HTMLLinkElement | null = this.doc.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private setJsonLdForCharity(charity: CharityProfile, canonical: string) {
    if (this.jsonLdScriptElement) {
      this.doc.head.removeChild(this.jsonLdScriptElement);
      this.jsonLdScriptElement = undefined;
    }

    const jsonLdObject: any = {
      '@context': 'https://schema.org',
      '@type': 'NGO',
      name: charity.name,
      url: canonical,
      description: charity.charity.description || charity.charity.shortDescription || charity.about || charity.charity.mission || '',
      image: charity.picture || undefined,
      sameAs: [charity.website].filter(Boolean),
      potentialAction: {
        '@type': 'DonateAction',
        target: canonical,
        recipient: {
          '@type': 'NGO',
          name: charity.name
        }
      }
    };

    const script = this.doc.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(jsonLdObject);
    this.doc.head.appendChild(script);
    this.jsonLdScriptElement = script;
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
