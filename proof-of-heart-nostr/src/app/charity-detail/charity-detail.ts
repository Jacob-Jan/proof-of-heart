import { Component, DOCUMENT, Inject, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CharityProfile, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Meta, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

const LNURL_PROXY_BASE = 'https://poh-lnurl-proxy.proofofheart.workers.dev';

@Component({
  selector: 'app-charity-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './charity-detail.html',
  styleUrl: './charity-detail.scss'
})
export class CharityDetailComponent implements OnInit, OnDestroy {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
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
  ratingHover = 0;
  ratingNote = '';
  reportReason: 'spam' | 'impersonation' | 'scam' = 'scam';
  reportNote = '';
  showRateDialog = false;
  showFlagDialog = false;
  hasFlagged = false;

  visitorPubkey = '';
  signerConnected = false;
  localCharitySignedIn = false;
  canEdit = false;

  donationMode: 'sats' | 'usd' = 'sats';
  donationInput = 1000;
  btcUsdRate = 0;
  donating = false;
  donationStatus = '';
  lastInvoice = '';
  showDonateModal = false;
  qrDataUrl = '';
  readonly isLikelyMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  get donationAddress(): string {
    return (this.charity?.charity.lightningAddress || this.charity?.lud16 || '').trim();
  }

  get canDonate(): boolean {
    return !!this.donationAddress && this.donationAddress.includes('@') && this.donationSats > 0 && !this.donating;
  }

  // single CTA flow uses canDonate directly

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
    this.signerConnected = await this.nostr.hasSigner();
    this.localCharitySignedIn = this.signerConnected && this.nostr.hasLocalOnboarding(this.visitorPubkey);

    await this.refreshCharity();
    this.loading = false;

    // Non-blocking: rate fetch should never delay profile rendering.
    this.loadBtcUsdRate();
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

    const applyCharity = async (found?: CharityProfile) => {
      this.charity = found;
      this.canEdit = !!this.charity
        && !!this.visitorPubkey
        && this.localCharitySignedIn
        && this.charity.pubkey === this.visitorPubkey;

      if (this.charity) {
        if (this.visitorPubkey) {
          this.hasFlagged = await this.nostr.hasUserFlagged(this.charity.pubkey, this.visitorPubkey);
        } else {
          this.hasFlagged = false;
        }
        this.updateSeo(this.charity);
      } else {
        this.title.setTitle('Charity not found | Proof of Heart');
        this.meta.updateTag({ name: 'description', content: 'This charity profile could not be found on the currently queried relays.' });
        this.setCanonical('https://proofofheart.org/');
      }
    };

    // Fast path: load minimal data first so detail page appears quickly.
    const fast = await this.nostr.loadCharitiesFast(300);
    const fastFound = fast.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);
    await applyCharity(fastFound);

    // Background enrichment path: hydrate followers/ratings/flags/zaps without blocking first paint.
    this.nostr.loadCharities(300)
      .then(async (all) => {
        const fullFound = all.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);
        if (fullFound) await applyCharity(fullFound);
      })
      .catch((e) => {
        console.warn('Background charity detail enrichment failed', e);
      });
  }

  openRateDialog() {
    this.rating = 5;
    this.ratingHover = 0;
    this.ratingNote = '';
    this.showRateDialog = true;
  }

  closeRateDialog() {
    this.showRateDialog = false;
    this.ratingHover = 0;
  }

  setRating(value: number) {
    this.rating = Math.max(1, Math.min(5, Math.round(value)));
  }

  setRatingHover(value: number) {
    this.ratingHover = Math.max(0, Math.min(5, Math.round(value)));
  }

  clearRatingHover() {
    this.ratingHover = 0;
  }

  isStarActive(star: number): boolean {
    const activeValue = this.ratingHover || this.rating;
    return star <= activeValue;
  }

  openFlagDialog() {
    this.reportReason = 'scam';
    this.reportNote = '';
    this.showFlagDialog = true;
  }

  get flagDialogTitle(): string {
    return this.hasFlagged ? 'Remove your flag?' : 'Flag this charity';
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
      if (this.hasFlagged) {
        await this.nostr.publishUnreport(this.charity.pubkey);
        this.toast('Flag removed from Nostr.', 'success', 3000);
      } else {
        await this.nostr.publishReport(this.charity.pubkey, this.reportReason, this.reportNote);
        this.toast('Flag published to Nostr.', 'success', 3000);
      }
      this.closeFlagDialog();
      await this.refreshCharity();
    } catch (e: any) {
      this.toast(e?.message || 'Failed to update flag.', 'error', 4000);
    }
  }

  toggleDonationMode() {
    this.donationMode = this.donationMode === 'sats' ? 'usd' : 'sats';
  }

  private donationErrorMessage(err: any): string {
    const raw = String(err?.message || err || '').toLowerCase();

    if (raw.includes('status 429') || raw.includes('429') || raw.includes('rate limit')) {
      return 'The Lightning provider is temporarily rate limiting requests. Please retry in a few seconds.';
    }

    return err?.message || 'Could not create invoice.';
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

    this.showDonateModal = true;
    this.lastInvoice = '';
    this.qrDataUrl = '';
    this.donating = true;
    this.donationStatus = 'Connecting to signer and creating zap invoice…';

    try {
      const invoice = await this.createZapInvoice(lightningAddress, sats, true);
      this.lastInvoice = invoice;
      await this.generateQr(invoice);

      const launched = await this.tryLaunchInvoice(invoice);
      this.donationStatus = launched
        ? 'Invoice ready. Wallet open attempted. If nothing opened, use the options below.'
        : 'Invoice ready. Use Open wallet or Copy invoice.';
      if (!launched) {
        this.toast('Could not open wallet automatically. Use QR or copy invoice.', 'info', 3500);
      }

      setTimeout(() => this.refreshCharity(), 4000);
    } catch (e: any) {
      this.donationStatus = this.donationErrorMessage(e);
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

  get nostrProfileUriShort(): string {
    const uri = this.nostrProfileUri;
    if (!uri) return '';
    if (uri.length <= 28) return uri;
    return `${uri.slice(0, 16)}…${uri.slice(-8)}`;
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
    this.showDonateModal = true;
  }

  closeQrModal() {
    this.showDonateModal = false;
  }

  async openWalletAgain() {
    if (!this.lastInvoice) return;
    const launched = await this.tryLaunchInvoice(this.lastInvoice);
    if (!launched) {
      this.toast('Could not trigger a lightning app. Use QR or copy invoice.', 'info', 3500);
    }
  }

  private async generateQr(invoice: string) {
    try {
      const qrModule: any = await import('qrcode');
      const toDataURL = qrModule?.toDataURL || qrModule?.default?.toDataURL;
      if (typeof toDataURL !== 'function') {
        throw new Error('qrcode.toDataURL is unavailable in loaded module shape');
      }

      this.qrDataUrl = await toDataURL(`lightning:${invoice}`, {
        width: 320,
        margin: 1
      });
    } catch (err) {
      console.error('[PoH] QR generation failed', err);
      this.qrDataUrl = '';
    }
  }

  private async tryLaunchInvoice(invoice: string): Promise<boolean> {
    if (!invoice) return false;

    const lightningUri = `lightning:${invoice}`;

    try {
      const webln = (window as any)?.webln;
      if (webln?.enable && webln?.sendPayment) {
        await webln.enable();
        await webln.sendPayment(invoice);
        return true;
      }
    } catch {
      // ignore webln failures and fallback to URI launch
    }

    try {
      window.location.href = lightningUri;
      return true;
    } catch {
      return false;
    }
  }

  private async fetchJsonOrThrow(url: string): Promise<any> {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.reason || `Request failed (${res.status})`);
    }
    return data;
  }

  private isCorsLikeFetchError(err: unknown): boolean {
    const msg = String((err as any)?.message || err || '').toLowerCase();
    return msg.includes('failed to fetch') || msg.includes('networkerror');
  }

  private async loadPayParams(lightningAddress: string, name: string, domain: string): Promise<any> {
    const directUrl = `https://${domain}/.well-known/lnurlp/${name}`;

    try {
      return await this.fetchJsonOrThrow(directUrl);
    } catch (err) {
      if (!this.isCorsLikeFetchError(err)) throw err;
      console.warn('[PoH] lnurlp direct fetch failed, falling back to worker proxy', err);
      const proxyUrl = `${LNURL_PROXY_BASE}/lnurlp?address=${encodeURIComponent(lightningAddress)}`;
      return this.fetchJsonOrThrow(proxyUrl);
    }
  }

  private async fetchInvoiceFromCallback(callbackUrl: URL): Promise<any> {
    try {
      return await this.fetchJsonOrThrow(callbackUrl.toString());
    } catch (err) {
      if (!this.isCorsLikeFetchError(err)) throw err;
      console.warn('[PoH] lnurl callback direct fetch failed, falling back to worker proxy', err);

      const proxyUrl = new URL(`${LNURL_PROXY_BASE}/callback`);
      proxyUrl.searchParams.set('callback', callbackUrl.origin + callbackUrl.pathname);

      const amount = callbackUrl.searchParams.get('amount');
      if (amount) proxyUrl.searchParams.set('amount', amount);

      const nostr = callbackUrl.searchParams.get('nostr');
      if (nostr) proxyUrl.searchParams.set('nostr', nostr);

      const comment = callbackUrl.searchParams.get('comment');
      if (comment) proxyUrl.searchParams.set('comment', comment);

      return this.fetchJsonOrThrow(proxyUrl.toString());
    }
  }

  private async createZapInvoice(lightningAddress: string, sats: number, preferZap: boolean): Promise<string> {
    const [name, domain] = lightningAddress.split('@');
    if (!name || !domain) throw new Error('Invalid lightning address format.');

    const payParams = await this.loadPayParams(lightningAddress, name, domain);

    if (!payParams?.callback) {
      throw new Error('Lightning address does not expose a valid LNURL callback.');
    }

    const amountMsat = sats * 1000;
    if (amountMsat < Number(payParams.minSendable || 0) || amountMsat > Number(payParams.maxSendable || Number.MAX_SAFE_INTEGER)) {
      throw new Error('Amount is outside allowed range for this lightning address.');
    }

    const fetchLnurlInvoice = async (): Promise<string> => {
      const callbackUrl = new URL(payParams.callback);
      callbackUrl.searchParams.set('amount', String(amountMsat));
      const lnurlInvoice = await this.fetchInvoiceFromCallback(callbackUrl);
      if (!lnurlInvoice?.pr) throw new Error('No invoice returned by lightning endpoint.');
      return lnurlInvoice.pr;
    };

    let donorPubkey = this.visitorPubkey;
    if (!donorPubkey && window.nostr) {
      try {
        donorPubkey = await this.withTimeout(window.nostr.getPublicKey(), 2_500, 'Signer public key');
        this.visitorPubkey = donorPubkey;
      } catch {
        // signer unavailable/slow; continue with plain lnurl invoice
      }
    }

    const allowsZap = payParams?.allowsNostr === true && typeof payParams?.nostrPubkey === 'string' && payParams.nostrPubkey.length > 0;

    if (preferZap && donorPubkey && window.nostr && allowsZap) {
      const signer = window.nostr;
      const fetchSignedZapInvoice = async (): Promise<string> => {
        const relays = this.nostr.getActiveRelays();
        const zapRequest = {
          kind: 9734,
          created_at: Math.floor(Date.now() / 1000),
          content: `Proof of Heart zap request (optional): sign to attach Nostr zap metadata for ${sats} sats to ${this.charity?.name || 'this charity'}. Payment itself happens in your Lightning wallet via invoice/QR.`,
          pubkey: donorPubkey,
          tags: [
            ['relays', ...relays],
            ['amount', String(amountMsat)],
            ['p', this.charity!.pubkey]
          ]
        } as any;

        this.donationStatus = 'Approve zap signature in your Nostr signer (optional social proof)…';
        console.info('[PoH] donate:signer-request', {
          hasSigner: !!window.nostr,
          donorPubkey,
          userActivationActive: (navigator as any)?.userActivation?.isActive ?? null,
          amountMsat
        });

        const signedZap = await this.withTimeout(signer.signEvent(zapRequest), 8_000, 'Signer approval');

        const callbackUrl = new URL(payParams.callback);
        callbackUrl.searchParams.set('amount', String(amountMsat));
        callbackUrl.searchParams.set('nostr', JSON.stringify(signedZap));

        const zapInvoice = await this.fetchInvoiceFromCallback(callbackUrl);
        if (!zapInvoice?.pr) throw new Error('No invoice returned by zap callback.');
        return zapInvoice.pr;
      };

      try {
        return await fetchSignedZapInvoice();
      } catch (e) {
        console.warn('[PoH] donate:zap-path-failed, fallback to lnurl', e);
        this.donationStatus = 'Zap signature was not completed. You can still donate via regular invoice.';
      }
    }

    return fetchLnurlInvoice();
  }

  private updateSeo(charity: CharityProfile) {
    const title = `${charity.name} | Donate with Bitcoin on Proof of Heart`;
    const description = (charity.charity.shortDescription || charity.about || `Donate to ${charity.name} with lightning or zaps.`)
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
      description: charity.charity.description || charity.charity.shortDescription || charity.about || '',
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

