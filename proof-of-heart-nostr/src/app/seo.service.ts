import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, ActivatedRouteSnapshot, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { filter } from 'rxjs';

interface SeoRouteData {
  description?: string;
  canonicalPath?: string;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  start(): void {
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe(() => this.applySeo());

    this.applySeo();
  }

  private applySeo(): void {
    const leaf = this.getLeafRoute(this.router.routerState.snapshot.root);
    const pageTitle = leaf.title;
    const seoData = (leaf.data?.['seo'] as SeoRouteData | undefined) ?? {};

    if (typeof pageTitle === 'string' && pageTitle.trim()) {
      this.title.setTitle(pageTitle);
      this.meta.updateTag({ property: 'og:title', content: pageTitle });
      this.meta.updateTag({ name: 'twitter:title', content: pageTitle });
    }

    if (seoData.description) {
      this.meta.updateTag({ name: 'description', content: seoData.description });
      this.meta.updateTag({ property: 'og:description', content: seoData.description });
      this.meta.updateTag({ name: 'twitter:description', content: seoData.description });
    }

    const canonicalPath = seoData.canonicalPath ?? this.router.url.split('?')[0];
    this.setCanonical(canonicalPath);
    this.setHreflang(canonicalPath);
  }

  private setCanonical(path: string): void {
    const href = this.toAbsolute(path);
    let linkEl = this.document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!linkEl) {
      linkEl = this.document.createElement('link');
      linkEl.setAttribute('rel', 'canonical');
      this.document.head.appendChild(linkEl);
    }
    linkEl.setAttribute('href', href);
  }

  private setHreflang(path: string): void {
    const href = this.toAbsolute(path);
    this.upsertHreflang('x-default', href);
    this.upsertHreflang('en', href);
  }

  private upsertHreflang(lang: string, href: string): void {
    let linkEl = this.document.head.querySelector(`link[rel="alternate"][hreflang="${lang}"]`) as HTMLLinkElement | null;
    if (!linkEl) {
      linkEl = this.document.createElement('link');
      linkEl.setAttribute('rel', 'alternate');
      linkEl.setAttribute('hreflang', lang);
      this.document.head.appendChild(linkEl);
    }
    linkEl.setAttribute('href', href);
  }

  private toAbsolute(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return new URL(normalized, this.document.baseURI).toString();
  }

  private getLeafRoute(snapshot: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
    let current = snapshot;
    while (current.firstChild) {
      current = current.firstChild;
    }
    return current;
  }
}
