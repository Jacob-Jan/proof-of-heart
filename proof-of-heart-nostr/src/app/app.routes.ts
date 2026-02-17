import { Routes } from '@angular/router';
import { CharitiesComponent } from './charities/charities';
import { CharityDetailComponent } from './charity-detail/charity-detail';
import { ProfileEditorComponent } from './profile-editor/profile-editor';
import { AboutusComponent } from './static/aboutus';
import { PaperComponent } from './static/paper';
import { BitcoinDonationsComponent } from './static/bitcoin-donations';
import { BitcoinCharitiesComponent } from './static/bitcoin-charities';
import { ProofOfHeartStaticComponent } from './static/proof-of-heart';
import { PartnerComponent } from './static/partner';

export const routes: Routes = [
  { path: '', component: CharitiesComponent },
  { path: 'charity/:pubkey', component: CharityDetailComponent },
  { path: 'profile', component: ProfileEditorComponent },
  { path: 'signup', component: ProfileEditorComponent },
  { path: 'aboutus', component: AboutusComponent },
  { path: 'paper', component: PaperComponent },
  { path: 'bitcoin-donations', component: BitcoinDonationsComponent },
  { path: 'bitcoin-charities', component: BitcoinCharitiesComponent },
  { path: 'proof-of-heart', component: ProofOfHeartStaticComponent },
  { path: 'partner', component: PartnerComponent },
  { path: '**', redirectTo: '' }
];
