import { ApplicationConfig, inject, NgZone, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { NavigationEnd, provideRouter, Router } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { filter } from 'rxjs';

import { routes } from './app.routes';

declare global { interface Window { dataLayer: any[]; } }

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideAnimationsAsync(),
    provideAppInitializer(() => {
      const router = inject(Router);
      const zone = inject(NgZone);

      window.dataLayer = window.dataLayer || [];
      zone.runOutsideAngular(() => {
        router.events
          .pipe(filter(e => e instanceof NavigationEnd))
          .subscribe((e: any) => {
            window.dataLayer.push({
              event: 'page_view',
              page_path: e.urlAfterRedirects
            });
          });
      });
    })
  ]
};
