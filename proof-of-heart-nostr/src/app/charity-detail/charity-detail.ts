import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { CharityProfile, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-charity-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  async ngOnInit() {
    const pubkey = this.route.snapshot.paramMap.get('pubkey');
    const all = await this.nostr.loadCharities(200);
    this.charity = all.find(c => c.pubkey === pubkey);
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
}
