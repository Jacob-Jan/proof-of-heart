import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./charities/charities').then(m => m.CharitiesComponent),
    title: 'Donate to Charities on Nostr | Proof of Heart'
  },
  {
    path: 'charities/:pubkey',
    loadComponent: () => import('./charity-detail/charity-detail').then(m => m.CharityDetailComponent),
    title: 'Charity Profile | Proof of Heart'
  },
  {
    path: 'profile',
    loadComponent: () => import('./profile-editor/profile-editor').then(m => m.ProfileEditorComponent),
    title: 'Edit Charity Profile | Proof of Heart'
  },
  {
    path: 'charity/profile',
    loadComponent: () => import('./profile-editor/profile-editor').then(m => m.ProfileEditorComponent),
    title: 'Edit Charity Profile | Proof of Heart'
  },
  {
    path: 'charity/onboard',
    loadComponent: () => import('./charity-onboard/charity-onboard').then(m => m.CharityOnboardComponent),
    title: 'For charities | Proof of Heart'
  },
  {
    path: 'onboard',
    loadComponent: () => import('./charity-onboard/charity-onboard').then(m => m.CharityOnboardComponent),
    title: 'For charities | Proof of Heart'
  },
  {
    path: 'paper',
    loadComponent: () => import('./static/paper-page').then(m => m.PaperPageComponent),
    title: 'Proof of Heart Paper'
  },
  {
    path: 'bitcoin-charities',
    loadComponent: () => import('./static/seo-pages').then(m => m.SeoCharitiesPageComponent),
    title: 'Bitcoin Charities | Proof of Heart'
  },
  {
    path: 'bitcoin-donations',
    loadComponent: () => import('./static/seo-pages').then(m => m.SeoDonationsPageComponent),
    title: 'Bitcoin Donations | Proof of Heart'
  },
  {
    path: 'proof-of-heart',
    loadComponent: () => import('./static/seo-pages').then(m => m.SeoProofPageComponent),
    title: 'What is Proof of Heart?'
  },
  {
    path: 'partner',
    loadComponent: () => import('./static/partner-page').then(m => m.PartnerPageComponent),
    title: 'Partner | Proof of Heart'
  },
  {
    path: 'admin',
    loadComponent: () => import('./admin-insights/admin-insights').then(m => m.AdminInsightsComponent),
    title: 'Admin Insights | Proof of Heart'
  },
  { path: '**', redirectTo: '' }
];
