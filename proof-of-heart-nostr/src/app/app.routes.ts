import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./charities/charities').then(m => m.CharitiesComponent),
    title: 'Donate to Charities on Nostr | Proof of Heart',
    data: {
      seo: {
        description: 'Discover verified Bitcoin and Nostr-native charities. Donate with transparency through Proof of Heart.',
        canonicalPath: '/'
      }
    }
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
    title: 'For charities | Proof of Heart',
    data: {
      seo: {
        description: 'Onboard your nonprofit to receive transparent Bitcoin donations on Proof of Heart.',
        canonicalPath: '/charity/onboard'
      }
    }
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
    title: 'Bitcoin Charities | Proof of Heart',
    data: {
      seo: {
        description: 'Explore mission-driven charities accepting Bitcoin with Proof of Heart transparency.',
        canonicalPath: '/bitcoin-charities'
      }
    }
  },
  {
    path: 'bitcoin-donations',
    loadComponent: () => import('./static/seo-pages').then(m => m.SeoDonationsPageComponent),
    title: 'Bitcoin Donations | Proof of Heart',
    data: {
      seo: {
        description: 'Learn how Bitcoin donations work with open accountability for nonprofits and supporters.',
        canonicalPath: '/bitcoin-donations'
      }
    }
  },
  {
    path: 'proof-of-heart',
    loadComponent: () => import('./static/seo-pages').then(m => m.SeoProofPageComponent),
    title: 'What is Proof of Heart?',
    data: {
      seo: {
        description: 'Understand the Proof of Heart protocol for transparent, verifiable Bitcoin charity funding.',
        canonicalPath: '/proof-of-heart'
      }
    }
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
