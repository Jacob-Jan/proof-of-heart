import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
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
export class CharitiesComponent implements OnInit {
  private toast(message: string, kind: 'success' | 'error' | 'info' = 'info', duration = 3500) {
    this.snack.open(message, 'Close', { duration, panelClass: [`toast-${kind}`] });
  }
  private nostr = inject(NostrService);
  private router = inject(Router);
  private snack = inject(MatSnackBar);

  allCharities: CharityProfile[] = [];
  charities: CharityProfile[] = [];
  loading = true;

  filter_name = '';
  filter_category = '';
  filter_country = '';
  showAdvanced = false;

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.loading = true;
    try {
      this.allCharities = await this.nostr.loadCharities(200);
      this.applyFilters();
    } catch (e) {
      console.error(e);
      this.toast('Failed to load charities from relays.', 'error', 4500);
    } finally {
      this.loading = false;
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
    try {
      const { pubkey, npub } = await this.nostr.connectSigner();

      if (this.nostr.hasLocalOnboarding(pubkey)) {
        await this.nostr.ensureCharityProfile(pubkey);
        await this.router.navigate(['/charities', npub]);
        return;
      }

      await this.router.navigate(['/charity/onboard']);
    } catch (e: any) {
      this.toast(e?.message || 'Connect your Nostr signer to continue.', 'info', 3500);
      await this.router.navigate(['/charity/onboard']);
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
}
