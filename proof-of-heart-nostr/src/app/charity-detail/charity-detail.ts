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
const ANDROID_SIGNER_ZAP_KEY = 'poh:pending-android-signer-zap';
const PENDING_ZAP_PAYMENT_KEY = 'poh:pending-zap-payment';
const ANDROID_SIGNER_ZAP_DEBUG_KEY = 'poh:nip55-debug-log';
const ANDROID_SIGNER_ZAP_CONSOLE_KEY = 'poh:nip55-console-log';
const ANDROID_SIGNER_ZAP_DEBUG_FLAG = 'poh:nip55-debug-enabled';
const ANDROID_SIGNER_ZAP_HASH_PREFIX = '#pohAndroidSignerZap=';
type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

interface PendingZapPayment {
  charityPubkey: string;
  invoice: string;
  donorPubkey: string;
  sats: number;
  since: number;
  zapRequestId?: string;
  createdAt: number;
}

function encodeLnurl(url: string): string {
  return bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), false).toUpperCase();
}

function isAndroidBrowser(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
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
  private androidSignerLaunchFallbackTimer?: ReturnType<typeof setTimeout>;
  private androidSignerResumeInFlight = false;
  private activeZapPaymentWatchKey = '';
  private donationAttemptToken = 0;
  private autoWalletLaunchPaymentKey = '';
  lastAndroidSignerUrl = '';
  nip55DebugMode = false;
  nip55DebugLog: string[] = [];
  consoleLog: string[] = [];
  private originalConsoleMethods?: Partial<Record<ConsoleMethod, (...args: any[]) => void>>;
  private consoleErrorHandler?: (event: ErrorEvent) => void;
  private unhandledRejectionHandler?: (event: PromiseRejectionEvent) => void;
  private readonly androidSignerResumeHandler = () => {
    this.debugNip55('resume event', {
      hash: this.safeLocationHash(),
      visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown'
    });
    void this.resumeAndroidSignerZapIfPresent();
    this.resumePendingZapPaymentIfPresent();
  };

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
    this.currentIdParam = this.cleanCharityIdParam(this.route.snapshot.paramMap.get('pubkey') || '');

    this.initNip55DebugMode();
    this.installAndroidSignerResumeListeners();
    this.debugNip55('component init', {
      android: isAndroidBrowser(),
      path: typeof window !== 'undefined' ? window.location.pathname : '',
      hash: this.safeLocationHash()
    });

    this.visitorPubkey = await this.nostr.getCurrentPubkey();
    this.signerConnected = await this.nostr.hasSigner();
    this.localCharitySignedIn = this.signerConnected && this.nostr.hasLocalOnboarding(this.visitorPubkey);

    await this.refreshCharity();
    await this.resumeAndroidSignerZapIfPresent();

    // Non-blocking: rate fetch should never delay profile rendering.
    this.loadBtcUsdRate();
  }

  ngOnDestroy(): void {
    this.uninstallAndroidSignerResumeListeners();
    this.uninstallConsoleCapture();
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
        this.resumePendingZapPaymentIfPresent();
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
    const token = this.donationAttemptToken;

    const sats = this.donationSats;
    const lightningAddress = this.donationAddress;
    this.donationStatus = 'Creating plain Lightning invoice…';

    try {
      const invoice = await this.createLightningInvoice(lightningAddress, sats);
      if (!this.isCurrentDonationAttempt(token)) return;
      await this.presentInvoice(invoice, 'Lightning invoice ready. Pay with your wallet; this does not publish a Nostr zap receipt.', undefined, token);
      this.scheduleLightningThanksCard();
    } catch (e: any) {
      if (!this.isCurrentDonationAttempt(token)) return;
      this.donationStatus = this.donationErrorMessage(e);
    } finally {
      if (this.isCurrentDonationAttempt(token)) this.donating = false;
    }
  }

  async zapWithNostr() {
    if (!this.prepareDonation('zap')) return;
    const token = this.donationAttemptToken;
    const sats = this.donationSats;
    const lightningAddress = this.donationAddress;
    const since = Math.floor(Date.now() / 1000) - 10;

    if (!window.nostr) {
      if (isAndroidBrowser()) {
        try {
          await this.startAndroidSignerZap(lightningAddress, sats, since);
          return;
        } catch (e: any) {
          if (!this.isCurrentDonationAttempt(token)) return;
          this.donationStatus = this.donationErrorMessage(e);
          this.donating = false;
          return;
        }
      }

      this.donationStatus = 'A Nostr signer is required for verified zaps. On Android, use Amber or another NIP-55 signer; on desktop, use a NIP-07 extension.';
      this.toast('Connect a Nostr signer to zap.', 'error', 3500);
      this.donating = false;
      return;
    }

    this.donationStatus = 'Preparing standard NIP-57 zap request…';

    try {
      const { invoice, donorPubkey, zapRequestId } = await this.createNip57ZapInvoice(lightningAddress, sats);
      if (!this.isCurrentDonationAttempt(token)) return;
      const payment: PendingZapPayment = {
        charityPubkey: this.charity!.pubkey,
        invoice,
        donorPubkey,
        sats,
        since,
        zapRequestId,
        createdAt: Date.now()
      };
      await this.presentInvoice(invoice, 'Zap invoice ready. Pay it with your wallet; Proof of Heart counts it only after a standard NIP-57 receipt appears on relays.', () => {
        this.writePendingZapPayment(payment);
        void this.watchForZapReceipt(payment);
      }, token, false);
    } catch (e: any) {
      if (!this.isCurrentDonationAttempt(token)) return;
      this.donationStatus = this.donationErrorMessage(e);
    } finally {
      if (this.isCurrentDonationAttempt(token)) this.donating = false;
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
    this.lastAndroidSignerUrl = '';
    this.clearDonationTimers();
    this.donating = true;
    this.donationAttemptToken += 1;
    return true;
  }

  private isCurrentDonationAttempt(token: number): boolean {
    return token === this.donationAttemptToken && this.showDonateModal;
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
    if (this.androidSignerLaunchFallbackTimer) {
      clearTimeout(this.androidSignerLaunchFallbackTimer);
      this.androidSignerLaunchFallbackTimer = undefined;
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

  private async presentInvoice(invoice: string, readyMessage: string, beforeWalletLaunch?: () => void, token?: number, autoLaunchWallet = true) {
    this.lastInvoice = invoice;
    await this.generateQr(invoice);
    if (token !== undefined && !this.isCurrentDonationAttempt(token)) return;

    beforeWalletLaunch?.();

    if (!autoLaunchWallet) {
      this.donationStatus = `${readyMessage} Use Open wallet or scan/copy the invoice below. Checking relays for the verified NIP-57 receipt…`;
      return;
    }

    this.donationStatus = `${readyMessage} Opening wallet… If nothing opens, use the options below.`;

    const launched = await this.tryLaunchInvoice(invoice);
    if (token !== undefined && !this.isCurrentDonationAttempt(token)) return;
    this.donationStatus = launched
      ? `${readyMessage} Wallet open attempted. Checking relays for the verified NIP-57 receipt…`
      : `${readyMessage} Use Open wallet or Copy invoice. Checking relays for the verified NIP-57 receipt…`;
    if (!launched) {
      this.toast('Could not open wallet automatically. Use QR or copy invoice.', 'info', 3500);
    }
  }

  private writePendingZapPayment(payment: PendingZapPayment): void {
    try {
      window.localStorage.setItem(PENDING_ZAP_PAYMENT_KEY, JSON.stringify(payment));
    } catch {
      // ignore storage failures; the in-memory watcher below still runs while the page is alive
    }
  }

  private readPendingZapPayment(): PendingZapPayment | null {
    try {
      const raw = window.localStorage.getItem(PENDING_ZAP_PAYMENT_KEY) || '';
      if (!raw) return null;
      return JSON.parse(raw) as PendingZapPayment;
    } catch {
      return null;
    }
  }

  private clearPendingZapPayment(payment?: PendingZapPayment): void {
    try {
      if (!payment) {
        window.localStorage.removeItem(PENDING_ZAP_PAYMENT_KEY);
        return;
      }

      const current = this.readPendingZapPayment();
      if (!current || this.zapPaymentWatchKey(current) === this.zapPaymentWatchKey(payment)) {
        window.localStorage.removeItem(PENDING_ZAP_PAYMENT_KEY);
      }
    } catch {
      // ignore storage failures
    }
  }

  private zapPaymentWatchKey(payment: PendingZapPayment): string {
    return `${payment.charityPubkey}:${payment.zapRequestId || payment.donorPubkey}:${payment.since}:${payment.sats}`;
  }

  private resumePendingZapPaymentIfPresent(options: { autoOpenWallet?: boolean } = {}): void {
    if (typeof window === 'undefined' || !this.charity) return;
    const payment = this.readPendingZapPayment();
    if (!payment || payment.charityPubkey !== this.charity.pubkey) return;

    const watchKey = this.zapPaymentWatchKey(payment);
    this.donationFlow = 'zap';
    this.showDonateModal = true;
    this.lastInvoice = payment.invoice;
    this.donationStatus = 'Zap invoice ready. Tap Open wallet, scan the QR, or copy the invoice. Checking relays for the verified NIP-57 receipt…';
    void this.generateQr(payment.invoice);
    void this.watchForZapReceipt(payment);

    if (options.autoOpenWallet && this.autoWalletLaunchPaymentKey !== watchKey) {
      this.autoWalletLaunchPaymentKey = watchKey;
      this.donationStatus = 'Restored pending zap invoice. Tap Open wallet, scan the QR, or copy the invoice.';
      void this.tryLaunchInvoice(payment.invoice).then((launched) => {
        const current = this.readPendingZapPayment();
        if (!current || this.zapPaymentWatchKey(current) !== watchKey || !this.showDonateModal) return;
        this.donationStatus = launched
          ? 'Wallet open attempted. Checking relays for the verified NIP-57 zap receipt…'
          : 'Use Open wallet or Copy invoice. Checking relays for the verified NIP-57 zap receipt…';
      });
    }
  }

  private async watchForZapReceipt(payment: PendingZapPayment) {
    if (!this.charity) return;
    const watchKey = this.zapPaymentWatchKey(payment);
    if (this.activeZapPaymentWatchKey === watchKey) return;
    this.activeZapPaymentWatchKey = watchKey;

    const receipt = await this.nostr.waitForNip57ZapReceipt({
      charityPubkey: payment.charityPubkey,
      donorPubkey: payment.donorPubkey,
      amountSats: payment.sats,
      since: payment.since,
      zapRequestId: payment.zapRequestId,
      timeoutMs: 300_000
    });

    if (this.activeZapPaymentWatchKey !== watchKey) return;
    this.activeZapPaymentWatchKey = '';

    if (!receipt || !this.charity || this.charity.pubkey !== payment.charityPubkey) {
      this.donationStatus = 'Payment may still be settling. The verified zap will appear after the standard NIP-57 receipt reaches relays.';
      return;
    }

    this.clearPendingZapPayment(payment);
    this.donationStatus = 'Verified NIP-57 zap receipt found on relays.';
    this.celebrateZapReceipt();
    this.recentZapReceipts = [receipt, ...this.recentZapReceipts.filter((r) => r.receiptId !== receipt.receiptId)].slice(0, 8);
    await this.refreshCharity();
  }

  async copyInvoice() {
    if (!this.lastInvoice) return;
    const copied = await this.copyTextToClipboard(this.lastInvoice);
    if (copied) {
      this.donationStatus = 'Invoice copied to clipboard.';
      this.toast('Invoice copied to clipboard.', 'success', 2500);
    } else {
      this.donationStatus = 'Could not copy automatically. Long-press/select the invoice text below, or scan the QR.';
      this.toast('Could not copy automatically. Long-press the invoice text.', 'info', 4500);
    }
  }

  private async copyTextToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall back to execCommand below; Android LAN/http contexts often block clipboard.writeText.
    }

    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      const copied = document.execCommand('copy');
      textarea.remove();
      return copied;
    } catch {
      return false;
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
    this.cancelDonationFlow();
    this.showDonateModal = false;
    this.showLightningThanksCard = false;
    this.showZapCelebration = false;
    this.clearDonationTimers();
  }

  private cancelDonationFlow(): void {
    this.donationAttemptToken += 1;
    this.donating = false;
    this.donationStatus = '';
    this.lastInvoice = '';
    this.lastAndroidSignerUrl = '';
    this.qrDataUrl = '';
    this.activeZapPaymentWatchKey = '';
    this.autoWalletLaunchPaymentKey = '';
    this.clearPendingZapPayment();
    this.clearPendingAndroidSignerZap();
    this.debugNip55('donation flow cancelled by user');
  }

  async openWalletAgain() {
    if (!this.lastInvoice) return;
    const launched = await this.tryLaunchInvoice(this.lastInvoice);
    this.donationStatus = launched ? 'Wallet open attempted. Checking for payment…' : 'Could not open wallet automatically. Copy or scan the invoice instead.';
  }

  openAndroidSignerAgain() {
    if (!this.lastAndroidSignerUrl) return;
    this.debugNip55('manual signer reopen', { signerUrlLength: this.lastAndroidSignerUrl.length });
    this.donating = true;
    this.donationStatus = 'Opening Android signer again… If Amber does not appear, return here and tap Open signer again.';
    this.armAndroidSignerLaunchFallback();
    const launched = this.launchExternalUri(this.lastAndroidSignerUrl);
    this.debugNip55('manual signer launch attempted', { launched });
    if (!launched) {
      this.donating = false;
      this.donationStatus = 'Could not trigger Amber from this browser. Tap Open signer again or try Chrome/Firefox on Android.';
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

    return this.launchExternalUri(lightningUri);
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
    const { payParams, amountMsat, zapRequest } = await this.prepareNip57ZapRequest(lightningAddress, sats);

    if (!window.nostr) throw new Error('No Nostr signer found (install a NIP-07 extension).');

    this.donationStatus = 'Approve the standard NIP-57 zap request in your Nostr signer…';
    const signedZap = await this.withTimeout(window.nostr.signEvent(zapRequest), 15_000, 'Signer approval');
    return this.createInvoiceFromSignedZap(payParams.callback, amountMsat, signedZap);
  }

  private async prepareNip57ZapRequest(lightningAddress: string, sats: number): Promise<{ payParams: any; amountMsat: number; zapRequest: any }> {
    const { payParams, name, domain } = await this.loadLnurlPayParams(lightningAddress);

    const amountMsat = sats * 1000;
    this.assertLnurlAmountAllowed(payParams, amountMsat);

    const allowsZap = payParams?.allowsNostr === true && typeof payParams?.nostrPubkey === 'string' && payParams.nostrPubkey.length > 0;
    if (!allowsZap) {
      throw new Error('This Lightning address does not advertise NIP-57 zap support. Use Donate with Lightning instead.');
    }

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

    return { payParams, amountMsat, zapRequest };
  }

  private async createInvoiceFromSignedZap(callback: string, amountMsat: number, signedZap: any): Promise<{ invoice: string; donorPubkey: string; zapRequestId?: string }> {
    const donorPubkey = signedZap?.pubkey || '';
    if (!donorPubkey) throw new Error('Signer did not return a donor pubkey on the zap request.');
    this.visitorPubkey = donorPubkey;
    this.signerConnected = true;
    const invoice = await this.requestInvoice(callback, amountMsat, signedZap);
    return { invoice, donorPubkey, zapRequestId: signedZap?.id };
  }

  private async startAndroidSignerZap(lightningAddress: string, sats: number, since: number): Promise<void> {
    this.debugNip55('startAndroidSignerZap', { lightningAddress, sats, since });
    const { payParams, amountMsat, zapRequest } = await this.prepareNip57ZapRequest(lightningAddress, sats);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Amber appends the encoded signed event directly to callbackUrl. On Android it may
    // strip query/hash parts from callbackUrl before appending, so keep the callback prefix
    // as the plain charity path and recover the signed event from the path suffix + the
    // pending request stored above.
    const callbackUrl = `${window.location.origin}${this.cleanCharityPathname(window.location.pathname)}`;

    const signerUrl = `nostrsigner:${encodeURIComponent(JSON.stringify(zapRequest))}`
      + `?compressionType=none&returnType=event&type=sign_event&callbackUrl=${encodeURIComponent(callbackUrl)}`;
    this.lastAndroidSignerUrl = signerUrl;

    this.writePendingAndroidSignerZap({
      requestId,
      callback: payParams.callback,
      amountMsat,
      sats,
      since,
      signerUrl,
      callbackUrl,
      createdAt: Date.now()
    });
    this.debugNip55('pending zap stored', {
      requestId,
      amountMsat,
      callbackHost: this.safeHost(payParams.callback),
      callbackUrl,
      localStorage: this.storageHas(window.localStorage, ANDROID_SIGNER_ZAP_KEY),
      sessionStorage: this.storageHas(window.sessionStorage, ANDROID_SIGNER_ZAP_KEY)
    });

    this.debugNip55('opening signer', {
      callbackUrl,
      signerUrlLength: signerUrl.length,
      zapKind: zapRequest.kind,
      tagCount: zapRequest.tags?.length || 0
    });
    this.donating = false;
    this.donationStatus = 'Signer request ready. Tap Open signer to approve the standard NIP-57 zap request in Amber.';
    this.debugNip55('signer request ready for manual launch', { signerUrlLength: signerUrl.length });
  }

  private armAndroidSignerLaunchFallback(): void {
    if (this.androidSignerLaunchFallbackTimer) {
      clearTimeout(this.androidSignerLaunchFallbackTimer);
    }
    this.androidSignerLaunchFallbackTimer = setTimeout(() => {
      if (!this.lastAndroidSignerUrl || this.lastInvoice || !this.showDonateModal) return;
      this.donating = false;
      this.donationStatus = 'Still waiting for Android signer. Tap Open signer to retry; this reuses the same standard NIP-57 zap request.';
      this.debugNip55('signer launch fallback visible');
    }, 7_000);
  }

  private initNip55DebugMode(): void {
    if (typeof window === 'undefined') return;
    const href = window.location.href;
    const params = new URL(href).searchParams;
    const enabled = params.get('debugNip55') === '1'
      || params.get('debugnip55') === '1'
      || href.toLowerCase().includes('debugnip55=1')
      || window.localStorage.getItem(ANDROID_SIGNER_ZAP_DEBUG_FLAG) === '1';
    this.nip55DebugMode = enabled;
    if (!enabled) return;
    window.localStorage.setItem(ANDROID_SIGNER_ZAP_DEBUG_FLAG, '1');
    try {
      this.nip55DebugLog = JSON.parse(window.localStorage.getItem(ANDROID_SIGNER_ZAP_DEBUG_KEY) || '[]');
    } catch {
      this.nip55DebugLog = [];
    }
    try {
      this.consoleLog = JSON.parse(window.localStorage.getItem(ANDROID_SIGNER_ZAP_CONSOLE_KEY) || '[]');
    } catch {
      this.consoleLog = [];
    }
    this.installConsoleCapture();
  }

  clearNip55DebugLog(): void {
    this.nip55DebugLog = [];
    try {
      window.localStorage.removeItem(ANDROID_SIGNER_ZAP_DEBUG_KEY);
    } catch {
      // ignore
    }
  }

  clearConsoleLog(): void {
    this.consoleLog = [];
    try {
      window.localStorage.removeItem(ANDROID_SIGNER_ZAP_CONSOLE_KEY);
    } catch {
      // ignore
    }
  }

  private debugNip55(label: string, data: Record<string, any> = {}): void {
    if (!this.nip55DebugMode || typeof window === 'undefined') return;
    const safeData = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, this.safeDebugValue(value)]));
    const entry = `${new Date().toISOString()} ${label} ${JSON.stringify(safeData)}`;
    this.nip55DebugLog = [...this.nip55DebugLog.slice(-29), entry];
    try {
      window.localStorage.setItem(ANDROID_SIGNER_ZAP_DEBUG_KEY, JSON.stringify(this.nip55DebugLog));
      console.info('[PoH NIP55]', label, safeData);
    } catch {
      // ignore logging failures
    }
  }

  private installConsoleCapture(): void {
    if (!this.nip55DebugMode || typeof window === 'undefined' || this.originalConsoleMethods) return;

    const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];
    this.originalConsoleMethods = {};

    for (const method of methods) {
      const original = (console as any)[method]?.bind(console) || (() => undefined);
      this.originalConsoleMethods[method] = original;
      (console as any)[method] = (...args: any[]) => {
        this.captureConsoleLog(method, args);
        original(...args);
      };
    }

    this.consoleErrorHandler = (event: ErrorEvent) => {
      this.captureConsoleLog('error', [event.message, event.filename, event.lineno, event.colno, event.error?.stack || event.error]);
    };
    this.unhandledRejectionHandler = (event: PromiseRejectionEvent) => {
      this.captureConsoleLog('error', ['Unhandled promise rejection', event.reason?.stack || event.reason]);
    };
    window.addEventListener('error', this.consoleErrorHandler);
    window.addEventListener('unhandledrejection', this.unhandledRejectionHandler);
  }

  private uninstallConsoleCapture(): void {
    if (typeof window !== 'undefined') {
      if (this.consoleErrorHandler) window.removeEventListener('error', this.consoleErrorHandler);
      if (this.unhandledRejectionHandler) window.removeEventListener('unhandledrejection', this.unhandledRejectionHandler);
    }

    if (!this.originalConsoleMethods) return;
    for (const [method, original] of Object.entries(this.originalConsoleMethods)) {
      if (original) (console as any)[method] = original;
    }
    this.originalConsoleMethods = undefined;
    this.consoleErrorHandler = undefined;
    this.unhandledRejectionHandler = undefined;
  }

  private captureConsoleLog(method: ConsoleMethod, args: any[]): void {
    if (!this.nip55DebugMode || typeof window === 'undefined') return;
    const time = new Date().toLocaleTimeString();
    const message = args.map((arg) => this.formatConsoleArg(arg)).join(' ');
    const entry = `${time} [${method}] ${message}`.slice(0, 1200);
    this.consoleLog = [...this.consoleLog.slice(-49), entry];
    try {
      window.localStorage.setItem(ANDROID_SIGNER_ZAP_CONSOLE_KEY, JSON.stringify(this.consoleLog));
    } catch {
      // ignore storage quota/privacy-mode errors
    }
  }

  private formatConsoleArg(arg: any): string {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === 'string') return arg;
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  private safeDebugValue(value: any): any {
    if (typeof value !== 'string') return value;
    if (value.length <= 180) return value;
    return `${value.slice(0, 100)}…(${value.length} chars)`;
  }

  private safeLocationHash(): string {
    if (typeof window === 'undefined') return '';
    const hash = window.location.hash || '';
    if (!hash) return '';
    return hash.startsWith(ANDROID_SIGNER_ZAP_HASH_PREFIX)
      ? `${ANDROID_SIGNER_ZAP_HASH_PREFIX}(len ${hash.length})`
      : `${hash.slice(0, 40)}(len ${hash.length})`;
  }

  private safeHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }

  private storageHas(store: Storage, key: string): boolean {
    try {
      return !!store.getItem(key);
    } catch {
      return false;
    }
  }

  private cleanCharityIdParam(idParam: string): string {
    // Amber can reopen Edge as /charities/<64hex><encoded-signed-event-json> when it
    // appends the signed event directly to a query-stripped callbackUrl. Keep the route
    // resolvable by treating the first 64 hex chars as the actual charity pubkey.
    const hexMatch = idParam.match(/^([0-9a-f]{64})(?:\{|%7B|%7b).*/);
    return hexMatch ? hexMatch[1] : idParam;
  }

  private cleanCharityPathname(pathname: string): string {
    const match = pathname.match(/^(\/charities\/)([0-9a-f]{64})(?:\{|%7B|%7b).*/);
    if (match) return `${match[1]}${match[2]}`;
    const markerIndex = pathname.indexOf(';androidSignerZap=');
    return markerIndex >= 0 ? pathname.slice(0, markerIndex) : pathname;
  }

  private readDirectAppendedAndroidSignerZapCallback(pathname: string): { requestId: string; signedZapRaw: string } | null {
    const match = pathname.match(/^\/charities\/([0-9a-f]{64})((?:\{|%7B|%7b).*)$/);
    if (!match) return null;

    const pending = this.peekPendingAndroidSignerZap();
    if (!pending?.requestId) {
      this.debugNip55('direct path callback found without pending zap', { pathLength: pathname.length });
      return null;
    }

    let signedZapRaw = match[2];
    try {
      signedZapRaw = decodeURIComponent(signedZapRaw);
    } catch {
      // Keep raw; JSON.parse later will produce the user-visible error if it is invalid.
    }

    this.debugNip55('direct path callback parsed', {
      requestId: pending.requestId,
      signedZapLength: signedZapRaw.length
    });
    return { requestId: pending.requestId, signedZapRaw };
  }

  private readPackedAndroidSignerZapCallbackFromPath(pathname: string): { requestId: string; signedZapRaw: string } | null {
    const marker = ';androidSignerZap=';
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex < 0) return null;

    const packed = pathname.slice(markerIndex + marker.length);
    const separator = packed.indexOf(':');
    if (separator < 1) {
      this.debugNip55('path callback missing separator', { pathLength: pathname.length });
      return null;
    }

    try {
      const parsed = {
        requestId: decodeURIComponent(packed.slice(0, separator)),
        signedZapRaw: decodeURIComponent(packed.slice(separator + 1))
      };
      this.debugNip55('path callback parsed', {
        requestId: parsed.requestId,
        signedZapLength: parsed.signedZapRaw.length
      });
      return parsed;
    } catch {
      const fallback = {
        requestId: packed.slice(0, separator),
        signedZapRaw: packed.slice(separator + 1)
      };
      this.debugNip55('path callback parsed without decoding', {
        requestId: fallback.requestId,
        signedZapLength: fallback.signedZapRaw.length
      });
      return fallback;
    }
  }

  private stripAndroidSignerZapPathCallback(pathname: string): string {
    const markerIndex = pathname.indexOf(';androidSignerZap=');
    return markerIndex >= 0 ? pathname.slice(0, markerIndex) : pathname;
  }

  private readAndroidSignerZapCallback(): { requestId: string; signedZapRaw: string } | null {
    const url = new URL(window.location.href);
    const directPathCallback = this.readDirectAppendedAndroidSignerZapCallback(url.pathname);
    if (directPathCallback) return directPathCallback;

    const pathCallback = this.readPackedAndroidSignerZapCallbackFromPath(url.pathname);
    if (pathCallback) return pathCallback;

    const queryCallbackRaw = url.searchParams.get('androidSignerZap') || '';
    const legacySignedZapRaw = url.searchParams.get('signedZap') || '';
    if (queryCallbackRaw && legacySignedZapRaw) {
      this.debugNip55('legacy query callback detected', {
        requestId: queryCallbackRaw,
        signedZapLength: legacySignedZapRaw.length
      });
      return { requestId: queryCallbackRaw, signedZapRaw: legacySignedZapRaw };
    }

    const querySeparator = queryCallbackRaw.indexOf(':');
    if (querySeparator > 0) {
      const parsed = {
        requestId: queryCallbackRaw.slice(0, querySeparator),
        signedZapRaw: queryCallbackRaw.slice(querySeparator + 1)
      };
      this.debugNip55('packed query callback parsed', {
        requestId: parsed.requestId,
        signedZapLength: parsed.signedZapRaw.length
      });
      return parsed;
    }

    const hash = window.location.hash || '';
    if (!hash.startsWith(ANDROID_SIGNER_ZAP_HASH_PREFIX)) {
      this.debugNip55('no NIP55 callback in URL', { hash: this.safeLocationHash() });
      return null;
    }

    const raw = hash.slice(ANDROID_SIGNER_ZAP_HASH_PREFIX.length);
    const separator = raw.indexOf(':');
    if (separator < 1) {
      this.debugNip55('callback hash missing separator', { hashLength: hash.length });
      return null;
    }

    try {
      const parsed = {
        requestId: decodeURIComponent(raw.slice(0, separator)),
        signedZapRaw: decodeURIComponent(raw.slice(separator + 1))
      };
      this.debugNip55('hash callback parsed', {
        requestId: parsed.requestId,
        signedZapLength: parsed.signedZapRaw.length
      });
      return parsed;
    } catch {
      const fallback = {
        requestId: raw.slice(0, separator),
        signedZapRaw: raw.slice(separator + 1)
      };
      this.debugNip55('hash callback parsed without decoding', {
        requestId: fallback.requestId,
        signedZapLength: fallback.signedZapRaw.length
      });
      return fallback;
    }
  }

  private installAndroidSignerResumeListeners(): void {
    if (typeof window === 'undefined' || !isAndroidBrowser()) return;
    window.addEventListener('hashchange', this.androidSignerResumeHandler);
    window.addEventListener('focus', this.androidSignerResumeHandler);
    window.addEventListener('pageshow', this.androidSignerResumeHandler);
    document.addEventListener('visibilitychange', this.androidSignerResumeHandler);
  }

  private uninstallAndroidSignerResumeListeners(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('hashchange', this.androidSignerResumeHandler);
    window.removeEventListener('focus', this.androidSignerResumeHandler);
    window.removeEventListener('pageshow', this.androidSignerResumeHandler);
    document.removeEventListener('visibilitychange', this.androidSignerResumeHandler);
  }

  private writePendingAndroidSignerZap(pending: any): void {
    const value = JSON.stringify(pending);
    try {
      window.localStorage.setItem(ANDROID_SIGNER_ZAP_KEY, value);
    } catch {
      // ignore storage quota / privacy mode failures; sessionStorage fallback below may still work
    }
    try {
      window.sessionStorage.setItem(ANDROID_SIGNER_ZAP_KEY, value);
    } catch {
      // ignore storage quota / privacy mode failures
    }
  }

  private takePendingAndroidSignerZap(): any {
    let pending: any;
    for (const store of [window.sessionStorage, window.localStorage]) {
      try {
        const raw = store.getItem(ANDROID_SIGNER_ZAP_KEY) || '';
        if (!pending && raw) pending = JSON.parse(raw);
        store.removeItem(ANDROID_SIGNER_ZAP_KEY);
      } catch {
        // keep trying the next store
      }
    }
    return pending;
  }

  private peekPendingAndroidSignerZap(): any {
    for (const store of [window.sessionStorage, window.localStorage]) {
      try {
        const raw = store.getItem(ANDROID_SIGNER_ZAP_KEY) || '';
        if (raw) return JSON.parse(raw);
      } catch {
        // keep trying the next store
      }
    }
    return undefined;
  }

  private clearPendingAndroidSignerZap(): void {
    for (const store of [window.sessionStorage, window.localStorage]) {
      try {
        store.removeItem(ANDROID_SIGNER_ZAP_KEY);
      } catch {
        // keep trying the next store
      }
    }
  }

  private restorePendingAndroidSignerZapIfPresent(): void {
    const pending = this.peekPendingAndroidSignerZap();
    if (!pending?.signerUrl || this.lastInvoice || !this.charity) return;
    const ageMs = Date.now() - Number(pending.createdAt || 0);
    if (ageMs > 10 * 60 * 1000) return;

    this.donationFlow = 'zap';
    this.showDonateModal = true;
    this.donating = false;
    this.lastAndroidSignerUrl = pending.signerUrl;
    this.donationStatus = 'Returned from Android signer without a signed zap event. Tap Open signer to retry the same standard NIP-57 request.';
    this.debugNip55('pending signer zap restored without callback', {
      requestId: pending.requestId || '',
      callbackUrl: pending.callbackUrl || '',
      ageMs
    });
  }

  private async resumeAndroidSignerZapIfPresent(): Promise<void> {
    if (typeof window === 'undefined' || this.androidSignerResumeInFlight) {
      this.debugNip55('resume skipped', {
        inFlight: this.androidSignerResumeInFlight,
        hasWindow: typeof window !== 'undefined'
      });
      return;
    }

    const signerCallback = this.readAndroidSignerZapCallback();
    if (!signerCallback) {
      this.restorePendingAndroidSignerZapIfPresent();
      return;
    }

    this.androidSignerResumeInFlight = true;
    const { requestId, signedZapRaw } = signerCallback;
    this.debugNip55('resume callback found', { requestId, signedZapLength: signedZapRaw.length });

    const cleanUrl = new URL(window.location.href);
    cleanUrl.pathname = this.cleanCharityPathname(cleanUrl.pathname);
    cleanUrl.searchParams.delete('androidSignerZap');
    cleanUrl.searchParams.delete('signedZap');
    cleanUrl.hash = '';
    window.history.replaceState({}, '', cleanUrl.toString());

    const pending = this.takePendingAndroidSignerZap();
    this.debugNip55('pending zap loaded', {
      exists: !!pending,
      pendingRequestId: pending?.requestId || '',
      callbackHost: pending?.callback ? this.safeHost(pending.callback) : '',
      amountMsat: pending?.amountMsat || 0
    });

    if (!pending || pending.requestId !== requestId) {
      this.androidSignerResumeInFlight = false;
      this.debugNip55('pending mismatch', { callbackRequestId: requestId, pendingRequestId: pending?.requestId || '' });
      this.toast('Android signer response did not match this zap attempt.', 'error', 4000);
      return;
    }

    try {
      const signedZap = JSON.parse(signedZapRaw);
      this.debugNip55('signed zap parsed', {
        kind: signedZap?.kind,
        id: signedZap?.id || '',
        pubkey: signedZap?.pubkey ? `${signedZap.pubkey.slice(0, 8)}…` : '',
        sigPresent: !!signedZap?.sig
      });
      this.donationFlow = 'zap';
      this.showDonateModal = true;
      this.donating = true;
      this.lastAndroidSignerUrl = '';
      if (this.androidSignerLaunchFallbackTimer) {
        clearTimeout(this.androidSignerLaunchFallbackTimer);
        this.androidSignerLaunchFallbackTimer = undefined;
      }
      const token = ++this.donationAttemptToken;
      this.donationStatus = 'Signed zap request received from Amber. Creating invoice…';
      this.debugNip55('requesting invoice', {
        callbackHost: this.safeHost(pending.callback),
        amountMsat: pending.amountMsat
      });
      const { invoice, donorPubkey, zapRequestId } = await this.withTimeout(
        this.createInvoiceFromSignedZap(pending.callback, pending.amountMsat, signedZap),
        15_000,
        'Creating zap invoice'
      );
      if (!this.isCurrentDonationAttempt(token)) return;
      this.debugNip55('invoice created', {
        invoicePrefix: invoice ? invoice.slice(0, 12) : '',
        donorPubkey: donorPubkey ? `${donorPubkey.slice(0, 8)}…` : '',
        zapRequestId: zapRequestId || ''
      });
      const payment: PendingZapPayment = {
        charityPubkey: this.charity!.pubkey,
        invoice,
        donorPubkey,
        sats: Number(pending.sats || 0),
        since: Number(pending.since || Math.floor(Date.now() / 1000) - 10),
        zapRequestId,
        createdAt: Date.now()
      };
      await this.presentInvoice(invoice, 'Zap invoice ready. Pay it with your wallet; Proof of Heart counts it only after a standard NIP-57 receipt appears on relays.', () => {
        this.writePendingZapPayment(payment);
        this.debugNip55('zap receipt watch started before wallet launch', {
          donorPubkey: donorPubkey ? `${donorPubkey.slice(0, 8)}…` : '',
          sats: payment.sats,
          since: payment.since,
          zapRequestId: zapRequestId || ''
        });
        void this.watchForZapReceipt(payment);
      }, token, false);
    } catch (e: any) {
      if (!this.showDonateModal) return;
      this.debugNip55('resume failed', { message: e?.message || String(e) });
      this.donationStatus = this.donationErrorMessage(e);
      this.toast(this.donationStatus, 'error', 4500);
    } finally {
      if (this.showDonateModal) this.donating = false;
      this.androidSignerResumeInFlight = false;
    }
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

