import { Component, DOCUMENT, Inject, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CharityProfile, Nip57ZapReceipt, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Meta, Title } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { bech32 } from '@scure/base';

const LNURL_PROXY_BASE = 'https://poh-lnurl-proxy.proofofheart.workers.dev';

function encodeLnurl(url: string): string {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), false).toUpperCase();
}

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
  followersLoaded = false;

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
  donationFlow: 'lightning' | 'zap' = 'lightning';
  lastInvoice = '';
  showDonateModal = false;
  showLightningThanksCard = false;
  showZapCelebration = false;
  qrDataUrl = '';
  recentZapReceipts: Nip57ZapReceipt[] = [];
  recentZapsLoading = false;
  loadStatus = 'fetching charity profile from nostr relays...';
  loadStatusTone: 'relay' | 'cache' | 'success' | 'warning' = 'relay';
  private lightningThanksTimer?: ReturnType<typeof setTimeout>;
  private zapCelebrationTimer?: ReturnType<typeof setTimeout>;

  get loadStatusBadge(): string {
    if (this.loadStatusTone === 'cache') return 'Cache';
    if (this.loadStatusTone === 'success') return 'Live';
    if (this.loadStatusTone === 'warning') return 'Relay issue';
    return 'Loading';
  }

  get loadStatusIcon(): string {
    if (this.loadStatusTone === 'cache') return 'fa-database';
    if (this.loadStatusTone === 'success') return 'fa-circle-check';
    if (this.loadStatusTone === 'warning') return 'fa-triangle-exclamation';
    return 'fa-arrows-rotate';
  }
  private refreshToken = 0;

  get donationAddress(): string {
    return (this.charity?.charity.lightningAddress || this.charity?.lud16 || '').trim();
  }

  get canDonate(): boolean {
    return !!this.donationAddress && this.donationAddress.includes('@') && this.donationSats > 0 && !this.donating;
  }

  get canZapWithNostr(): boolean {
    return this.canDonate && this.signerConnected;
  }

  get donationModalTitle(): string {
    return this.donationFlow === 'zap' ? 'Complete your Nostr zap' : 'Complete your Lightning donation';
  }

  donorLabel(pubkey: string): string {
    if (!pubkey) return 'Unknown donor';
    try {
      const npub = nip19.npubEncode(pubkey);
      return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
    } catch {
      return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
    }
  }

  formatZapDate(createdAt: number): string {
    if (!createdAt) return '';
    return new Date(createdAt * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // donation flows intentionally separate plain Lightning from verified NIP-57 zaps

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

    // Non-blocking: rate fetch should never delay profile rendering.
    this.loadBtcUsdRate();
  }

  ngOnDestroy(): void {
    this.nostr.clearCharityFeedStatus();
    this.clearDonationTimers();
    if (this.jsonLdScriptElement) {
      this.doc.head.removeChild(this.jsonLdScriptElement);
      this.jsonLdScriptElement = undefined;
    }
  }

  async refreshCharity() {
    const refreshToken = ++this.refreshToken;
    const idParam = this.currentIdParam;

    this.charity = undefined;
    this.loading = true;
    this.followersLoaded = false;
    this.canEdit = false;
    this.hasFlagged = false;
    this.loadStatus = 'fetching charity profile from nostr relays...';
    this.loadStatusTone = 'relay';
    this.nostr.setCharityFeedStatus('relay', this.loadStatus);

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

    const isCurrent = () => refreshToken === this.refreshToken;

    const applyCharity = async (found?: CharityProfile, enriched = false) => {
      if (!isCurrent()) return;
      this.charity = found;
      this.followersLoaded = enriched || !!found?.followersLoaded;
      this.canEdit = !!this.charity
        && !!this.visitorPubkey
        && this.localCharitySignedIn
        && this.charity.pubkey === this.visitorPubkey;

      if (this.charity) {
        this.updateSeo(this.charity);
        this.loadRecentZapReceipts(this.charity.pubkey, isCurrent);
        this.loading = false;

        if (this.visitorPubkey) {
          void this.nostr.hasUserFlagged(this.charity.pubkey, this.visitorPubkey)
            .then((flagged) => {
              if (!isCurrent()) return;
              this.hasFlagged = flagged;
            })
            .catch((e) => {
              if (!isCurrent()) return;
              console.warn('Flag status check failed', e);
            });
        } else {
          this.hasFlagged = false;
        }
      } else {
        this.title.setTitle('Charity not found | Proof of Heart');
        this.meta.updateTag({ name: 'description', content: 'This charity profile could not be found on the currently queried relays.' });
        this.setCanonical('https://proofofheart.org/');
      }
    };

    this.followersLoaded = false;

    const cachedDetail = this.nostr.readCachedCharity(resolvedPubkey);
    if (cachedDetail) {
      this.loadStatus = 'restored charity profile from local cache; checking relays...';
      this.loadStatusTone = 'cache';
      await applyCharity(cachedDetail);
    }

    // Fast path: load minimal data first so detail page appears quickly.
    const fast = await this.nostr.loadCharitiesFast(300, 10 * 60 * 1000);
    if (!isCurrent()) return;
    const fastFound = fast.charities.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);
    if (fastFound) {
      this.nostr.cacheCharityDetail(fastFound);
      this.loadStatus = fast.fromCache
        ? 'showing cached charity profile while relays refresh in the background...'
        : 'loaded charity profile from nostr relays.';
      this.loadStatusTone = fast.fromCache ? 'cache' : 'success';
      this.nostr.setCharityFeedStatus(this.loadStatusTone, this.loadStatus);
      await applyCharity(fastFound);
    }

    // Background enrichment path: hydrate followers/ratings/flags/zaps without blocking first paint.
    this.nostr.loadCharities(300)
      .then(async (all) => {
        if (!isCurrent()) return;
        const fullFound = all.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);
        if (fullFound) {
          this.nostr.cacheCharityDetail(fullFound);
          this.loadStatus = 'charity profile refreshed from relays.';
          this.loadStatusTone = 'success';
          this.nostr.setCharityFeedStatus('success', this.loadStatus);
          await applyCharity(fullFound, true);
        } else if (!this.charity) {
          this.loadStatus = 'charity profile not found on the currently queried relays.';
          this.loadStatusTone = 'warning';
          this.nostr.setCharityFeedStatus('warning', this.loadStatus);
          this.loading = false;
          this.followersLoaded = true;
        } else {
          this.followersLoaded = true;
        }
      })
      .catch((e) => {
        if (!isCurrent()) return;
        console.warn('Background charity detail enrichment failed', e);
        this.followersLoaded = true;
        if (!this.charity) {
          this.loadStatus = 'failed to refresh charity profile from nostr relays.';
          this.loadStatusTone = 'warning';
          this.nostr.setCharityFeedStatus('warning', this.loadStatus);
          this.loading = false;
        }
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

  private loadRecentZapReceipts(pubkey: string, isCurrent: () => boolean) {
    if (!pubkey) return;
    this.recentZapsLoading = true;
    this.nostr.loadNip57ZapReceiptsForCharity(pubkey, 8)
      .then((receipts) => {
        if (!isCurrent()) return;
        this.recentZapReceipts = receipts;
      })
      .catch((err) => {
        if (!isCurrent()) return;
        console.warn('[PoH] recent zap receipts failed', err);
      })
      .finally(() => {
        if (!isCurrent()) return;
        this.recentZapsLoading = false;
      });
  }

  private donationErrorMessage(err: any): string {
    const raw = String(err?.message || err || '').toLowerCase();

    if (raw.includes('status 429') || raw.includes('429') || raw.includes('rate limit')) {
      return 'The Lightning provider is temporarily rate limiting requests. Please retry in a few seconds.';
    }

    return err?.message || 'Could not create invoice.';
  }

  async donate() {
    await this.donateWithLightning();
  }

  async donateWithLightning() {
    if (!this.prepareDonation('lightning')) return;

    const sats = this.donationSats;
    const lightningAddress = this.donationAddress;
    this.donationStatus = 'Creating plain Lightning invoice…';

    try {
      const invoice = await this.createLightningInvoice(lightningAddress, sats);
      await this.presentInvoice(invoice, 'Lightning invoice ready. Pay with your wallet; this does not publish a Nostr zap receipt.');
      this.scheduleLightningThanksCard();
    } catch (e: any) {
      this.donationStatus = this.donationErrorMessage(e);
    } finally {
      this.donating = false;
    }
  }

  async zapWithNostr() {
    if (!this.prepareDonation('zap')) return;
    if (!window.nostr) {
      this.donationStatus = 'A Nostr signer is required for verified zaps.';
      this.toast('Connect a Nostr signer to zap.', 'error', 3500);
      this.donating = false;
      return;
    }

    const sats = this.donationSats;
    const lightningAddress = this.donationAddress;
    const since = Math.floor(Date.now() / 1000) - 10;
    this.donationStatus = 'Preparing standard NIP-57 zap request…';

    try {
      const { invoice, donorPubkey, zapRequestId } = await this.createNip57ZapInvoice(lightningAddress, sats);
      await this.presentInvoice(invoice, 'Zap invoice ready. Pay it with your wallet; Proof of Heart counts it only after a standard NIP-57 receipt appears on relays.');
      void this.watchForZapReceipt(donorPubkey, sats, since, zapRequestId);
    } catch (e: any) {
      this.donationStatus = this.donationErrorMessage(e);
    } finally {
      this.donating = false;
    }
  }

  private prepareDonation(flow: 'lightning' | 'zap'): boolean {
    if (!this.charity) return false;

    const sats = this.donationSats;
    if (!sats || sats <= 0) {
      this.toast('Enter a valid donation amount.', 'error', 3000);
      return false;
    }

    const lightningAddress = this.donationAddress;
    if (!lightningAddress.includes('@')) {
      this.toast('No valid lightning address found for this charity.', 'error', 3500);
      return false;
    }

    this.donationFlow = flow;
    this.showDonateModal = true;
    this.lastInvoice = '';
    this.qrDataUrl = '';
    this.showLightningThanksCard = false;
    this.showZapCelebration = false;
    this.clearDonationTimers();
    this.donating = true;
    return true;
  }

  private clearDonationTimers() {
    if (this.lightningThanksTimer) {
      clearTimeout(this.lightningThanksTimer);
      this.lightningThanksTimer = undefined;
    }
    if (this.zapCelebrationTimer) {
      clearTimeout(this.zapCelebrationTimer);
      this.zapCelebrationTimer = undefined;
    }
  }

  private scheduleLightningThanksCard() {
    if (this.lightningThanksTimer) clearTimeout(this.lightningThanksTimer);
    this.lightningThanksTimer = setTimeout(() => {
      if (this.showDonateModal && this.donationFlow === 'lightning' && this.lastInvoice) {
        this.showLightningThanksCard = true;
      }
      this.lightningThanksTimer = undefined;
    }, 5_000);
  }

  private celebrateZapReceipt() {
    this.showZapCelebration = true;
    if (this.zapCelebrationTimer) clearTimeout(this.zapCelebrationTimer);
    this.zapCelebrationTimer = setTimeout(() => {
      this.zapCelebrationTimer = undefined;

      if (this.showDonateModal && this.donationFlow === 'zap') {
        this.closeQrModal();
        return;
      }

      this.showZapCelebration = false;
    }, 8_000);
  }

  private async presentInvoice(invoice: string, readyMessage: string) {
    this.lastInvoice = invoice;
    await this.generateQr(invoice);

    const launched = await this.tryLaunchInvoice(invoice);
    this.donationStatus = launched
      ? `${readyMessage} Wallet open attempted. If nothing opened, use the options below.`
      : `${readyMessage} Use Open wallet or Copy invoice.`;
    if (!launched) {
      this.toast('Could not open wallet automatically. Use QR or copy invoice.', 'info', 3500);
    }
  }

  private async watchForZapReceipt(donorPubkey: string, sats: number, since: number, zapRequestId?: string) {
    if (!this.charity) return;
    const charityPubkey = this.charity.pubkey;
    const receipt = await this.nostr.waitForNip57ZapReceipt({
      charityPubkey,
      donorPubkey,
      amountSats: sats,
      since,
      zapRequestId,
      timeoutMs: 300_000
    });

    if (!receipt || !this.charity || this.charity.pubkey !== charityPubkey) {
      this.donationStatus = 'Payment may still be settling. The verified zap will appear after the standard NIP-57 receipt reaches relays.';
      return;
    }

    this.donationStatus = 'Verified NIP-57 zap receipt found on relays.';
    this.celebrateZapReceipt();
    this.recentZapReceipts = [receipt, ...this.recentZapReceipts.filter((r) => r.receiptId !== receipt.receiptId)].slice(0, 8);
    await this.refreshCharity();
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
    this.showLightningThanksCard = false;
    this.showZapCelebration = false;
    this.clearDonationTimers();
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

  private async createLightningInvoice(lightningAddress: string, sats: number): Promise<string> {
    const { payParams } = await this.loadLnurlPayParams(lightningAddress);
    const amountMsat = sats * 1000;
    this.assertLnurlAmountAllowed(payParams, amountMsat);
    return this.requestInvoice(payParams.callback, amountMsat);
  }

  private async createNip57ZapInvoice(lightningAddress: string, sats: number): Promise<{ invoice: string; donorPubkey: string; zapRequestId?: string }> {
    const { payParams, name, domain } = await this.loadLnurlPayParams(lightningAddress);

    const amountMsat = sats * 1000;
    this.assertLnurlAmountAllowed(payParams, amountMsat);

    const allowsZap = payParams?.allowsNostr === true && typeof payParams?.nostrPubkey === 'string' && payParams.nostrPubkey.length > 0;
    if (!allowsZap) {
      throw new Error('This Lightning address does not advertise NIP-57 zap support. Use Donate with Lightning instead.');
    }

    if (!window.nostr) throw new Error('No Nostr signer found (install a NIP-07 extension).');

    const relays = this.nostr.getActiveRelays();
    const lnurl = encodeLnurl(`https://${domain}/.well-known/lnurlp/${name}`);
    const zapRequest = {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: `Proof of Heart zap for ${this.charity?.name || 'this charity'}`,
      tags: [
        ['relays', ...relays],
        ['amount', String(amountMsat)],
        ['lnurl', lnurl],
        ['p', this.charity!.pubkey]
      ]
    } as any;

    this.donationStatus = 'Approve the standard NIP-57 zap request in your Nostr signer…';
    const signedZap = await this.withTimeout(window.nostr.signEvent(zapRequest), 15_000, 'Signer approval');
    const donorPubkey = signedZap?.pubkey || '';
    if (!donorPubkey) throw new Error('Signer did not return a donor pubkey on the zap request.');
    this.visitorPubkey = donorPubkey;
    this.signerConnected = true;
    const invoice = await this.requestInvoice(payParams.callback, amountMsat, signedZap);
    return { invoice, donorPubkey, zapRequestId: signedZap?.id };
  }

  private async loadLnurlPayParams(lightningAddress: string): Promise<{ payParams: any; name: string; domain: string }> {
    const [name, domain] = lightningAddress.split('@');
    if (!name || !domain) throw new Error('Invalid lightning address format.');

    const payParams = await this.loadPayParams(lightningAddress, name, domain);
    if (!payParams?.callback) {
      throw new Error('Lightning address does not expose a valid LNURL callback.');
    }

    return { payParams, name, domain };
  }

  private assertLnurlAmountAllowed(payParams: any, amountMsat: number) {
    if (amountMsat < Number(payParams.minSendable || 0) || amountMsat > Number(payParams.maxSendable || Number.MAX_SAFE_INTEGER)) {
      throw new Error('Amount is outside allowed range for this lightning address.');
    }
  }

  private async requestInvoice(callback: string, amountMsat: number, signedZap?: any): Promise<string> {
    const callbackUrl = new URL(callback);
    callbackUrl.searchParams.set('amount', String(amountMsat));
    if (signedZap) callbackUrl.searchParams.set('nostr', JSON.stringify(signedZap));

    const invoiceResponse = await this.fetchInvoiceFromCallback(callbackUrl);
    if (!invoiceResponse?.pr) throw new Error('No invoice returned by lightning endpoint.');
    return invoiceResponse.pr;
  }

  private updateSeo(charity: CharityProfile) {
    const country = charity.charity.country?.trim();
    const category = charity.charity.category?.trim();
    const titleBits = [charity.name, category, country, 'Bitcoin Charity | Proof of Heart'].filter(Boolean);
    const title = titleBits.join(' · ');
    const description = (
      charity.charity.shortDescription
      || charity.about
      || `Support ${charity.name}${country ? ` in ${country}` : ''}${category ? ` (${category})` : ''} with Bitcoin and Lightning donations.`
    ).slice(0, 155);
    const canonical = `https://proofofheart.org/charities/${charity.npub}`;
    const image = this.toAbsoluteAssetUrl(charity.picture) || 'https://proofofheart.org/assets/logo.png';

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

  private toAbsoluteAssetUrl(url?: string): string | undefined {
    if (!url) return undefined;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    if (url.startsWith('/')) return `https://proofofheart.org${url}`;
    return `https://proofofheart.org/${url}`;
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

