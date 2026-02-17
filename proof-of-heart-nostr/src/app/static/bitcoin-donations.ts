import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-bitcoin-donations',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './bitcoin-donations.html'
})
export class BitcoinDonationsComponent implements OnInit {
  constructor(private title: Title, private meta: Meta) {}
  ngOnInit(): void {
    this.title.setTitle('Bitcoin Donations – Donate Bitcoin to Self-Custody Charities | Proof of Heart');
    this.meta.updateTag({ name: 'description', content: 'Learn how bitcoin donations and Lightning donations work, and how to donate directly.' });
  }
}
