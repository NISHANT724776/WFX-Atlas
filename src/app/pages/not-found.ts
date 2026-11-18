import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';

/** Body of the 404 page, reused by detail pages when a slug does not exist. */
@Component({
  selector: 'app-not-found-body',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="not-found">
      <p class="eyebrow">404</p>
      <h1>This page is not in the knowledge base</h1>
      <p class="lead">The link may be old or mistyped. These are good places to continue:</p>
      <ul class="card-grid">
        <li><a class="card link-card" routerLink="/"><strong>Home</strong><span class="muted small">Overview of the full WFX flow</span></a></li>
        <li><a class="card link-card" routerLink="/theory"><strong>Theory</strong><span class="muted small">All 15 transactions explained</span></a></li>
        <li><a class="card link-card" routerLink="/workflows"><strong>Workflows</strong><span class="muted small">Play the three WFX flows</span></a></li>
        <li><a class="card link-card" routerLink="/ask"><strong>Ask</strong><span class="muted small">Search definitions, formulas and cases</span></a></li>
      </ul>
    </section>
  `,
})
export class NotFoundBody {}

@Component({
  selector: 'app-not-found',
  imports: [NotFoundBody],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-not-found-body />`,
})
export default class NotFoundPage {
  constructor() {
    inject(SeoService).set({
      title: 'Page not found',
      description: 'The page you asked for is not in the WFX Knowledge Hub. Continue from the home page, transactions or data model.',
      path: '/404',
      noindex: true,
    });
  }
}
