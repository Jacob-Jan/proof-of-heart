import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-partner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './partner.html',
  styleUrl: './partner.scss'
})
export class PartnerComponent implements OnInit {
  public copied: boolean[] = [false, false];
  public embedCodeDark = `<a href="https://proofofheart.org" target="_blank" rel="noopener noreferrer">Donate bitcoin to charities on Proof of Heart</a>`;
  public embedCodeLight = this.embedCodeDark;

  constructor(private title: Title, private meta: Meta) {}
  ngOnInit(): void {
    this.title.setTitle('Partner with Proof of Heart');
    this.meta.updateTag({ name: 'description', content: 'Partner page for embedding Proof of Heart donation button.' });
  }

  public async copyToClipboard(text: string, buttonIndex: number): Promise<void> {
    await navigator.clipboard.writeText(text);
    this.copied = this.copied.map((_, i) => i === buttonIndex);
    setTimeout(() => (this.copied[buttonIndex] = false), 2000);
  }
}
