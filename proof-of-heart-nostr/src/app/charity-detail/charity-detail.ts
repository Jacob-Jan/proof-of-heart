import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { CharityProfile, NostrService } from '../nostr.service';
import { FormsModule } from '@angular/forms';
import { nip19 } from 'nostr-tools';

@Component({
  selector: 'app-charity-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
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
  visitorPubkey = '';
  canEdit = false;

  async ngOnInit() {
    const idParam = this.route.snapshot.paramMap.get('pubkey') || '';

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

    const all = await this.nostr.loadCharities(200);
    this.charity = all.find(c => c.pubkey === resolvedPubkey || c.npub === idParam);

    try {
      if (window.nostr) {
        this.visitorPubkey = await window.nostr.getPublicKey();
      }
    } catch {
      this.visitorPubkey = '';
    }

    this.canEdit = !!this.charity && !!this.visitorPubkey && this.charity.pubkey === this.visitorPubkey;
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
