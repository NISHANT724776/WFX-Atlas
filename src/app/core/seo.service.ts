import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { SITE } from '../data/catalog';

export interface Crumb {
  label: string;
  path: string;
}

export interface PageSeo {
  title: string;
  description: string;
  path: string;
  crumbs?: Crumb[];
  /** Extra schema.org nodes for this page. */
  schema?: Record<string, unknown>[];
  noindex?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly doc = inject(DOCUMENT);

  /** Breadcrumb trail for the current page (rendered by the shell). */
  readonly crumbs = signal<Crumb[]>([]);

  set(p: PageSeo): void {
    const fullTitle = p.path === '/' ? p.title : `${p.title} | ${SITE.name}`;
    const url = SITE.url + (p.path === '/' ? '/' : p.path);
    const image = SITE.url + SITE.ogImage;

    this.title.setTitle(fullTitle);
    const tags: [string, string, 'name' | 'property'][] = [
      ['description', p.description, 'name'],
      ['robots', p.noindex ? 'noindex, follow' : 'index, follow', 'name'],
      ['og:site_name', SITE.name, 'property'],
      ['og:type', p.path === '/' ? 'website' : 'article', 'property'],
      ['og:locale', SITE.locale, 'property'],
      ['og:title', fullTitle, 'property'],
      ['og:description', p.description, 'property'],
      ['og:url', url, 'property'],
      ['og:image', image, 'property'],
      ['og:image:width', '1200', 'property'],
      ['og:image:height', '630', 'property'],
      ['og:image:alt', SITE.ogImageAlt, 'property'],
      ['twitter:card', 'summary_large_image', 'name'],
      ['twitter:title', fullTitle, 'name'],
      ['twitter:description', p.description, 'name'],
      ['twitter:image', image, 'name'],
      ['twitter:image:alt', SITE.ogImageAlt, 'name'],
    ];
    for (const [key, content, attr] of tags) {
      this.meta.updateTag({ [attr]: key, content }, `${attr}="${key}"`);
    }

    this.setCanonical(url, !p.noindex);

    const crumbs: Crumb[] = p.path === '/' ? [] : [{ label: 'Home', path: '/' }, ...(p.crumbs ?? [])];
    this.crumbs.set(crumbs);

    const graph: Record<string, unknown>[] = [
      { '@type': 'WebSite', '@id': `${SITE.url}/#website`, name: SITE.name, url: `${SITE.url}/`, inLanguage: 'en',
        potentialAction: { '@type': 'SearchAction', target: `${SITE.url}/ask?q={query}`, 'query-input': 'required name=query' } },
      { '@type': 'WebPage', '@id': `${url}#webpage`, url, name: fullTitle, description: p.description,
        isPartOf: { '@id': `${SITE.url}/#website` }, primaryImageOfPage: image },
    ];
    if (crumbs.length) {
      graph.push({
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({
          '@type': 'ListItem', position: i + 1, name: c.label, item: SITE.url + (c.path === '/' ? '/' : c.path),
        })),
      });
    }
    graph.push(...(p.schema ?? []));
    this.setJsonLd({ '@context': 'https://schema.org', '@graph': graph });
  }

  private setCanonical(href: string, enabled: boolean): void {
    let link = this.doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!enabled) {
      link?.remove();
      return;
    }
    if (!link) {
      link = this.doc.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.doc.head.appendChild(link);
    }
    link.setAttribute('href', href);
  }

  private setJsonLd(data: unknown): void {
    let el = this.doc.head.querySelector<HTMLScriptElement>('script#structured-data');
    if (!el) {
      el = this.doc.createElement('script');
      el.id = 'structured-data';
      el.type = 'application/ld+json';
      this.doc.head.appendChild(el);
    }
    // Escape "<" so the JSON can never close the script tag.
    el.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  }
}
