import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { CharityProfile, NostrService } from '../nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-charities',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatProgressSpinnerModule, MatButtonModule],
  templateUrl: './charities.html',
  styleUrl: './charities.scss'
})
export class CharitiesComponent implements OnInit, OnDestroy {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
  private nostr = inject(NostrService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);
  private doc = inject(DOCUMENT);

  private jsonLdScriptElement?: HTMLScriptElement;

  allCharities: CharityProfile[] = [];
  charities: CharityProfile[] = [];
  loading = true;
  charityCtaLoading = false;
  charityCtaStatus = '';
  enrichmentLoaded = false;
  loadStatus = 'fetching charities from nostr relays...';
  loadStatusTone: 'relay' | 'cache' | 'success' | 'warning' = 'relay';
  private reloadToken = 0;

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

  filter_name = '';
  filter_category = '';
  filter_country = '';
  showAdvanced = false;

  async ngOnInit() {
    await this.reload();
  }

  ngOnDestroy(): void {
    this.nostr.clearCharityFeedStatus();
    if (this.jsonLdScriptElement) {
      this.doc.head.removeChild(this.jsonLdScriptElement);
      this.jsonLdScriptElement = undefined;
    }
  }

  async reload() {
    this.loading = true;
    this.enrichmentLoaded = false;
    this.loadStatus = 'fetching charities from nostr relays...';
    this.loadStatusTone = 'relay';
    this.nostr.setCharityFeedStatus('relay', this.loadStatus);
    const token = ++this.reloadToken;
    try {
      // Fast path: render list as soon as kind 30078 + kind 0 are available.
      const fastResult = await this.nostr.loadCharitiesFast(200);
      if (token !== this.reloadToken) return;
      this.allCharities = fastResult.charities;
      this.applyFilters();
      this.updateHomeJsonLd();
      this.loading = false;
      this.loadStatus = fastResult.fromCache
        ? 'showing cached charities while relays refresh in the background...'
        : 'loaded charities from nostr relays.';
      this.loadStatusTone = fastResult.fromCache ? 'cache' : 'success';
      this.nostr.setCharityFeedStatus(this.loadStatusTone, this.loadStatus);

      // Background enrichment: hydrate followers/ratings/flags/zaps after first paint.
      this.nostr.loadCharities(200)
        .then((full) => {
          if (token !== this.reloadToken) return;
          // Keep visual order stable to avoid UI reshuffle while enrichment arrives.
          const order = new Map(this.allCharities.map((c, i) => [c.pubkey, i]));
          full.sort((a, b) => (order.get(a.pubkey) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.pubkey) ?? Number.MAX_SAFE_INTEGER));

          this.allCharities = full;
          this.enrichmentLoaded = true;
          this.applyFilters();
          this.updateHomeJsonLd();
          this.loadStatus = fastResult.fromCache
            ? 'refreshed charity data from relays.'
            : 'charity data refreshed from relays.';
          this.loadStatusTone = 'success';
          this.nostr.setCharityFeedStatus('success', this.loadStatus);
        })
        .catch((e) => {
          if (token !== this.reloadToken) return;
          console.warn('Background charity enrichment failed', e);
          this.enrichmentLoaded = true;
          this.loadStatus = fastResult.fromCache
            ? 'showing cached charities; relay refresh failed.'
            : 'relay refresh failed after the initial load.';
          this.loadStatusTone = fastResult.fromCache ? 'cache' : 'warning';
          this.nostr.setCharityFeedStatus(this.loadStatusTone, this.loadStatus);
        });
    } catch (e) {
      if (token !== this.reloadToken) return;
      console.error(e);
      this.toast('Failed to load charities from relays.', 'error', 4500);
      this.loading = false;
      this.enrichmentLoaded = true;
      this.loadStatus = 'failed to load charities from nostr relays.';
      this.loadStatusTone = 'warning';
      this.nostr.setCharityFeedStatus('warning', this.loadStatus);
    }
  }

  get categories(): string[] {
    const set = new Set(
      this.allCharities
        .map(c => c.charity.category?.trim())
        .filter((v): v is string => !!v)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  get countries(): string[] {
    const set = new Set(
      this.allCharities
        .map(c => c.charity.country?.trim())
        .filter((v): v is string => !!v)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  search(term: string) {
    this.filter_name = term;
    this.applyFilters();
  }

  filter() {
    this.applyFilters();
  }

  async goForCharities() {
    if (this.charityCtaLoading) return;
    this.charityCtaLoading = true;
    this.charityCtaStatus = 'Checking whether this signer is already connected as a charity…';
    try {
      const pubkey = await this.nostr.getCurrentPubkey();

      if (pubkey && this.nostr.hasLocalOnboarding(pubkey)) {
        this.charityCtaStatus = 'Opening charity profile editor…';
        await this.router.navigate(['/charity/profile']);
        return;
      }

      this.charityCtaStatus = 'Opening charity onboarding…';
      await this.router.navigate(['/charity/onboard']);
    } finally {
      this.charityCtaLoading = false;
    }
  }

  private applyFilters() {
    this.charities = this.allCharities
      .filter(c => c.charity.isVisible !== false)
      .filter(c => !c.hidden)
      .filter(c => {
        const matchesName = this.filter_name
          ? (c.name + ' ' + (c.about ?? '')).toLowerCase().includes(this.filter_name.toLowerCase())
          : true;

        const matchesCategory = this.filter_category
          ? (c.charity.category ?? '').toLowerCase() === this.filter_category.toLowerCase()
          : true;

        const matchesCountry = this.filter_country
          ? (c.charity.country ?? '').toLowerCase() === this.filter_country.toLowerCase()
          : true;

        return matchesName && matchesCategory && matchesCountry;
      });
  }

  goToCharity(pubkey: string) {
    this.router.navigate(['/charities', pubkey]);
  }

  private updateHomeJsonLd() {
    if (this.jsonLdScriptElement) {
      this.doc.head.removeChild(this.jsonLdScriptElement);
      this.jsonLdScriptElement = undefined;
    }

    const visible = this.allCharities
      .filter(c => c.charity.isVisible !== false)
      .filter(c => !c.hidden)
      .slice(0, 50);

    const jsonLdObject = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Proof of Heart — Bitcoin charities',
      url: 'https://proofofheart.org/',
      hasPart: {
        '@type': 'ItemList',
        numberOfItems: visible.length,
        itemListElement: visible.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: `https://proofofheart.org/charities/${c.npub}`,
          item: {
            '@type': 'NGO',
            name: c.name,
            url: `https://proofofheart.org/charities/${c.npub}`,
            description: c.about || c.charity.description || '',
            image: c.picture || 'https://proofofheart.org/assets/logo.png',
            areaServed: c.charity.country ? { '@type': 'Country', name: c.charity.country } : undefined,
            sameAs: c.website ? [c.website] : undefined
          }
        }))
      }
    };

    const script = this.doc.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(jsonLdObject);
    this.doc.head.appendChild(script);
    this.jsonLdScriptElement = script;
  }
}
