import { Component } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Component({
  selector: 'app-aboutus',
  standalone: true,
  templateUrl: './aboutus.html',
  styleUrl: './aboutus.scss'
})
export class AboutusComponent {
  constructor(private meta: Meta, private titleService: Title) {}

  ngOnInit() {
    this.titleService.setTitle('About us | Proof of Heart');
    this.meta.updateTag({ name: 'description', content: 'Get to know Proof of Heart better, who we are and why we are doing this.' });
  }
}
