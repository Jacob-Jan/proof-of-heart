import { Component, OnInit } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-proof-of-heart-static',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './proof-of-heart.html'
})
export class ProofOfHeartStaticComponent implements OnInit {
  constructor(private title: Title, private meta: Meta) {}
  ngOnInit(): void {
    this.title.setTitle('Proof of Heart – Open Bitcoin Charity Platform');
    this.meta.updateTag({ name: 'description', content: 'Proof of Heart is an open, non-custodial bitcoin charity platform.' });
  }
}
