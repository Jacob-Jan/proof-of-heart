import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CharityProfile, NostrService } from '../nostr.service';

@Component({
  selector: 'app-charities',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './charities.html',
  styleUrl: './charities.scss'
})
export class CharitiesComponent implements OnInit {
  private nostr = inject(NostrService);
  charities: CharityProfile[] = [];
  loading = true;
  showHidden = false;

  async ngOnInit() {
    await this.reload();
  }

  async reload() {
    this.loading = true;
    try {
      this.charities = await this.nostr.loadCharities(150);
    } catch (e) {
      console.error(e);
      alert('Failed to load charities from relays.');
    } finally {
      this.loading = false;
    }
  }

  get visibleCharities() {
    return this.showHidden ? this.charities : this.charities.filter(c => !c.hidden);
  }
}
