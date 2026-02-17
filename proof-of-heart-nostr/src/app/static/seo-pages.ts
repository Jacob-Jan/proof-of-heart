import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({ selector: 'app-seo-proof', standalone: true, imports: [RouterLink], templateUrl: './seo-proof.html' })
export class SeoProofPageComponent {}

@Component({ selector: 'app-seo-donations', standalone: true, imports: [RouterLink], templateUrl: './seo-donations.html' })
export class SeoDonationsPageComponent {}

@Component({ selector: 'app-seo-charities', standalone: true, imports: [RouterLink], templateUrl: './seo-charities.html' })
export class SeoCharitiesPageComponent {}
