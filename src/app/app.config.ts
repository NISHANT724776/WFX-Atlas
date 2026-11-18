import { ApplicationConfig, DOCUMENT, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  NavigationError, provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler, withViewTransitions,
} from '@angular/router';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

import { routes } from './app.routes';

const STALE_CHUNK = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i;

/**
 * After a new deploy the page files get new names. A tab still running the old version would then fail
 * to open the next page. Instead of failing silently, load the requested page fresh – once.
 */
function reloadOnStaleChunk(e: NavigationError): void {
  const message = String((e.error as Error | undefined)?.message ?? e.error ?? '');
  if (!STALE_CHUNK.test(message)) return;
  const win = inject(DOCUMENT).defaultView;
  if (!win) return;
  const key = 'wfx-chunk-reload';
  try {
    if (win.sessionStorage.getItem(key) === e.url) return; // already tried this page – avoid a reload loop
    win.sessionStorage.setItem(key, e.url);
  } catch { /* storage blocked – still reload */ }
  win.location.assign(e.url);
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'disabled' }),
      withViewTransitions({ skipInitialTransition: true }),
      withNavigationErrorHandler(reloadOnStaleChunk),
    ),
    provideClientHydration(withEventReplay()),
  ],
};
