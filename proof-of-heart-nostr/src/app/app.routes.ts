import { Routes } from '@angular/router';
import { CharitiesComponent } from './charities/charities';
import { CharityDetailComponent } from './charity-detail/charity-detail';
import { ProfileEditorComponent } from './profile-editor/profile-editor';
import { PaperPageComponent } from './static/paper-page';
import { PartnerPageComponent } from './static/partner-page';
import { SeoCharitiesPageComponent, SeoDonationsPageComponent, SeoProofPageComponent } from './static/seo-pages';

export const routes: Routes = [
  { path: '', component: CharitiesComponent },
  { path: 'charity/:pubkey', component: CharityDetailComponent },
  { path: 'charities/:pubkey', component: CharityDetailComponent },
  { path: 'profile', component: ProfileEditorComponent },
  { path: 'charity/profile', component: ProfileEditorComponent },

  { path: 'paper', component: PaperPageComponent },
  { path: 'bitcoin-charities', component: SeoCharitiesPageComponent },
  { path: 'bitcoin-donations', component: SeoDonationsPageComponent },
  { path: 'proof-of-heart', component: SeoProofPageComponent },
  { path: 'partner', component: PartnerPageComponent },

  { path: '**', redirectTo: '' }
];
