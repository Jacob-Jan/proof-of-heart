import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'app-partner-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './partner-page.html',
  styleUrl: './partner-page.scss'
})
export class PartnerPageComponent {
  copied: boolean[] = [false, false];
  embedCodeDark = `<a href="https://proofofheart.org/?utm_source=partner_site&utm_medium=referral&utm_campaign=donate_bitcoin_widget" target="_blank" rel="noopener noreferrer">Donate bitcoin to charities on Proof of Heart</a>`;
  embedCodeLight = `<a href="https://proofofheart.org/?utm_source=partner_site&utm_medium=referral&utm_campaign=donate_bitcoin_widget_light" target="_blank" rel="noopener noreferrer">Donate bitcoin to charities on Proof of Heart</a>`;

  async copyToClipboard(text: string, i: number) {
    await navigator.clipboard.writeText(text);
    this.copied = this.copied.map((_, idx) => idx === i);
    setTimeout(() => (this.copied[i] = false), 2000);
  }
}
