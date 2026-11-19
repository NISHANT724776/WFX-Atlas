import { RenderMode, ServerRoute } from '@angular/ssr';
import { COLOR_CARDS, COLORS, FLOW_INDEX, TXN_INDEX } from './data/catalog';

export const serverRoutes: ServerRoute[] = [
  {
    path: 'workflows/:flow',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => FLOW_INDEX.map((f) => ({ flow: f.slug })),
  },
  {
    path: 'theory/:slug',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => TXN_INDEX.map((t) => ({ slug: t.slug })),
  },
  {
    path: 'color-cards/:card',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => COLOR_CARDS.map((c) => ({ card: c.slug })),
  },
  {
    path: 'color-cards/:card/:color',
    renderMode: RenderMode.Prerender,
    getPrerenderParams: async () => COLORS.map((c) => ({ card: c.card, color: c.slug })),
  },
  // a saved workflow is opened by its ID and loaded from the knowledge server: it is drawn in the browser only
  { path: 'workflow-designer/:id', renderMode: RenderMode.Client },
  // a sales order is opened by its id from the server: drawn in the browser only
  { path: 'sales-order/:id', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Prerender },
];
