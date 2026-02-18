import { Routes } from '@angular/router';
import { CharitiesComponent } from './charities/charities';
import { CharityDetailComponent } from './charity-detail/charity-detail';
import { ProfileEditorComponent } from './profile-editor/profile-editor';
import { PaperPageComponent } from './static/paper-page';
import { PartnerPageComponent } from './static/partner-page';
import { SeoCharitiesPageComponent, SeoDonationsPageComponent, SeoProofPageComponent } from './static/seo-pages';

export const routes: Routes = [
  { path: '', component: CharitiesComponent, title: 'Donate to Charities on Nostr | Proof of Heart' },
  { path: 'charity/:pubkey', component: CharityDetailComponent, title: 'Charity Profile | Proof of Heart' },
  { path: 'charities/:pubkey', component: CharityDetailComponent, title: 'Charity Profile | Proof of Heart' },
  { path: 'profile', component: ProfileEditorComponent, title: 'Edit Charity Profile | Proof of Heart' },
  { path: 'charity/profile', component: ProfileEditorComponent, title: 'Edit Charity Profile | Proof of Heart' },

  { path: 'paper', component: PaperPageComponent, title: 'Proof of Heart Paper' },
  { path: 'bitcoin-charities', component: SeoCharitiesPageComponent, title: 'Bitcoin Charities | Proof of Heart' },
  { path: 'bitcoin-donations', component: SeoDonationsPageComponent, title: 'Bitcoin Donations | Proof of Heart' },
  { path: 'proof-of-heart', component: SeoProofPageComponent, title: 'What is Proof of Heart?' },
  { path: 'partner', component: PartnerPageComponent, title: 'Partner | Proof of Heart' },

  { path: '**', redirectTo: '' }
];
