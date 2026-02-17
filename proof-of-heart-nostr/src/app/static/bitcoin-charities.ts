import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-bitcoin-charities',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './bitcoin-charities.html'
})
export class BitcoinCharitiesComponent implements OnInit {
  constructor(private title: Title, private meta: Meta) {}
  ngOnInit(): void {
    this.title.setTitle('Bitcoin Charities & Non-Profits That Accept Bitcoin | Proof of Heart');
    this.meta.updateTag({ name: 'description', content: 'Discover bitcoin charities and bitcoin non-profits that accept bitcoin and Lightning donations directly.' });
  }
}
