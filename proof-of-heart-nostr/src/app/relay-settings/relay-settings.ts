import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NostrService, RelaySettings } from '../nostr.service';

const RECOMMENDED_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.wine',
  'wss://relay.snort.social'
];

@Component({
  selector: 'app-relay-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './relay-settings.html',
  styleUrl: './relay-settings.scss'
})
export class RelaySettingsComponent implements OnInit {
  private nostr = inject(NostrService);
  private snack = inject(MatSnackBar);
  private router = inject(Router);

  loading = false;
  saving = false;
  needsSignerForLoad = false;
  ownPubkey = '';
  ownNpub = '';
  relaySettings: RelaySettings = { relays: [], updatedAt: Date.now() };
  newRelayUrl = '';
  newRelayRead = true;
  newRelayWrite = true;

  async ngOnInit(): Promise<void> {
    await this.loadExisting();
  }

  private normalizeRelayUrl(raw: string): string {
    return String(raw || '').trim().replace(/\/+$/, '');
  }

  async loadExisting(): Promise<void> {
    this.loading = true;
    this.needsSignerForLoad = false;

    try {
      const { pubkey, npub } = await this.nostr.connectSigner();
      if (!this.nostr.hasLocalOnboarding(pubkey)) {
        this.snack.open('This charity account is disconnected on this device. Connect again from onboarding.', 'Close', { duration: 4500 });
        await this.router.navigate(['/charity/onboard']);
        return;
      }

      this.ownPubkey = pubkey;
      this.ownNpub = npub;
      this.relaySettings = await this.nostr.loadRelaySettings(pubkey);
    } catch (e) {
      console.error('[PoH] relay-settings:load-failed', e);
      this.needsSignerForLoad = true;
      this.snack.open('Could not load relay settings yet. Try again after reconnecting your signer.', 'Close', { duration: 4500 });
    } finally {
      this.loading = false;
    }
  }

  get readRelayCount(): number {
    return this.relaySettings.relays.filter((relay) => relay.read).length;
  }

  get writeRelayCount(): number {
    return this.relaySettings.relays.filter((relay) => relay.write).length;
  }

  get activeRelayCount(): number {
    return this.relaySettings.relays.length;
  }

  addRelay(): void {
    const url = this.normalizeRelayUrl(this.newRelayUrl);
    if (!url) return;
    if (!(url.startsWith('wss://') || url.startsWith('ws://'))) {
      this.snack.open('Relay URLs should start with wss:// or ws://', 'Close', { duration: 3200 });
      return;
    }

    const existing = this.relaySettings.relays.find((relay) => relay.url === url);
    if (existing) {
      existing.read = existing.read || this.newRelayRead;
      existing.write = existing.write || this.newRelayWrite;
    } else {
      this.relaySettings = {
        ...this.relaySettings,
        relays: [...this.relaySettings.relays, { url, read: this.newRelayRead, write: this.newRelayWrite }]
      };
    }

    this.relaySettings = {
      ...this.relaySettings,
      relays: [...this.relaySettings.relays].filter((relay, index, list) => list.findIndex((item) => item.url === relay.url) === index)
    };

    this.newRelayUrl = '';
    this.newRelayRead = true;
    this.newRelayWrite = true;
  }

  removeRelay(index: number): void {
    this.relaySettings = {
      ...this.relaySettings,
      relays: this.relaySettings.relays.filter((_, relayIndex) => relayIndex !== index)
    };
  }

  resetRecommended(): void {
    this.relaySettings = {
      relays: RECOMMENDED_RELAYS.map((url) => ({ url, read: true, write: true })),
      updatedAt: Date.now()
    };
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;

    try {
      const normalized: RelaySettings = this.nostr.normalizeRelaySettings({
        relays: this.relaySettings.relays,
        updatedAt: Date.now()
      });
      this.relaySettings = normalized;

      const id = await this.nostr.publishRelaySettings(this.ownPubkey, normalized);
      this.snack.open(`Published relay list event: ${id.slice(0, 10)}…`, 'Close', { duration: 4500 });
      this.relaySettings = await this.nostr.loadRelaySettings(this.ownPubkey);
    } catch (e: any) {
      console.error('[PoH] relay-settings:save-failed', e);
      this.snack.open(e?.message || 'Failed to save relay settings', 'Close', { duration: 4500 });
    } finally {
      this.saving = false;
    }
  }
}
