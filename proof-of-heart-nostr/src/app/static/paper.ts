import { Component } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-paper',
  standalone: true,
  templateUrl: './paper.html',
  styleUrl: './paper.scss'
})
export class PaperComponent {
  constructor(private title: Title, private meta: Meta) {}
  ngOnInit(): void {
    this.title.setTitle('Proof of Heart Whitepaper | Direct, Non-Custodial Bitcoin Donations');
    this.meta.updateTag({
      name: 'description',
      content: 'Read the Proof of Heart whitepaper explaining our open, non-custodial bitcoin donation platform that lets donors support charities directly and verify legitimacy.'
    });
  }
}
