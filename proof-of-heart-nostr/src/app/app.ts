import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header/header';
import { FooterComponent } from './footer/footer';
import { SeoService } from './seo.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, FooterComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly seoService = inject(SeoService);

  constructor() {
    this.seoService.start();
  }
}
