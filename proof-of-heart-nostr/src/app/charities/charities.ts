import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CharityProfile, NostrService } from '../nostr.service';

@Component({
  selector: 'app-charities',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, MatProgressSpinnerModule],
  templateUrl: './charities.html',
  styleUrl: './charities.scss'
})
export class CharitiesComponent implements OnInit {
  private nostr = inject(NostrService);
  private router = inject(Router);

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
      alert('Failed to load charities from relays.');
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
      await this.nostr.ensureCharityProfile(pubkey);
      await this.router.navigate(['/charities', npub]);
    } catch (e: any) {
      alert(e.message || 'Failed to connect Nostr signer');
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
