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
      // Fast path: render list as soon as kind 30078 + kind 0 are available.
      this.allCharities = await this.nostr.loadCharitiesFast(200);
      this.applyFilters();
      this.loading = false;

      // Background enrichment: hydrate followers/ratings/flags/zaps after first paint.
      this.nostr.loadCharities(200)
        .then((full) => {
          this.allCharities = full;
          this.applyFilters();
        })
        .catch((e) => {
          console.warn('Background charity enrichment failed', e);
        });
    } catch (e) {
      console.error(e);
      this.toast('Failed to load charities from relays.', 'error', 4500);
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
    const pubkey = await this.nostr.getCurrentPubkey();

    if (pubkey && this.nostr.hasLocalOnboarding(pubkey)) {
      await this.router.navigate(['/charity/profile']);
      return;
    }

    await this.router.navigate(['/charity/onboard']);
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
}
