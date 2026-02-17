import { Routes } from '@angular/router';
import { CharitiesComponent } from './charities/charities';
import { CharityDetailComponent } from './charity-detail/charity-detail';
import { ProfileEditorComponent } from './profile-editor/profile-editor';

export const routes: Routes = [
  { path: '', component: CharitiesComponent },
  { path: 'charity/:pubkey', component: CharityDetailComponent },
  { path: 'profile', component: ProfileEditorComponent },
  { path: '**', redirectTo: '' }
];
