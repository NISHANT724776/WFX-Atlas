// The homepage motif: three WFX journeys as lanes, real steps as nodes (ids and titles from data/journey.ts), and the
// documented links between lanes as connectors. Every node opens its transaction page; every lane label opens its
// ready-made workflow. Hover or focus a node to read its step. The accent connector is the Buyer Block Booking being
// linked on the Sales Order — a dot travels along it to show the direction (hidden when reduced motion is on).
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { stepById } from '../data/journey';

interface Node { id: string; x: number }
interface Lane { name: string; flow: string; y: number; nodes: Node[] }
const LANES: Lane[] = [
  { name: 'Style setup', flow: 'style-setup', y: 48, nodes: [{ id: 'masters', x: 24 }, { id: 'style', x: 96 }, { id: 'bom', x: 168 }, { id: 'approve', x: 240 }] },
  { name: 'Buyer Block Booking', flow: 'block-booking', y: 144, nodes: [{ id: 'bbb-create', x: 96 }, { id: 'bbb-bom', x: 264 }, { id: 'adhoc', x: 336 }, { id: 'grn', x: 408 }] },
  { name: 'Sales Order', flow: 'sales-order', y: 240, nodes: [{ id: 'oc', x: 48 }, { id: 'link', x: 144 }, { id: 'mrp', x: 240 }, { id: 'adjust', x: 336 }, { id: 'prod-order', x: 432 }] },
];
/** Steps at either end of the live connector. */
const LIVE = new Set(['bbb-create', 'link']);
const LIVE_PATH = 'M96 144C96 192 144 192 144 240';

@Component({
  selector: 'wfx-hero-motif',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="wfx-motif" viewBox="0 0 456 264" role="group" aria-labelledby="wfx-motif-t">
      <title id="wfx-motif-t">Three WFX journeys and how they connect. Choose a step to open its transaction, or a journey name to open its workflow.</title>
      @for (l of lanes; track l.name) {
        <a class="m-lane-link" [routerLink]="['/workflows', l.flow]" [attr.aria-label]="'Open the ' + l.name + ' workflow'"
           (mouseenter)="lane.set(l.flow)" (mouseleave)="lane.set(null)" (focus)="lane.set(l.flow)" (blur)="lane.set(null)">
          <text class="m-label" x="0" [attr.y]="l.y - 16">{{ l.name }} <tspan class="m-go">→</tspan></text>
        </a>
        <path class="m-lane" [class.m-lane-on]="lane() === l.flow" [attr.d]="'M0 ' + l.y + 'H456'" />
      }
      <!-- an approved BOM is selected on the booking -->
      <path class="m-link" d="M240 48C240 96 264 96 264 144" />
      <!-- booked stock (on order or in house) is adjusted against the sales order indent -->
      <path class="m-link" d="M408 144C408 192 336 192 336 240" />
      <!-- the booking is linked on the sales order: the live link -->
      <path class="m-link m-live" [attr.d]="livePath" />
      <circle class="m-packet" r="3.5"><animateMotion dur="2.8s" repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.55;1" calcMode="linear" [attr.path]="livePath" /></circle>
      @for (l of lanes; track l.name) {
        @for (n of l.nodes; track n.id) {
          <a class="m-step" [routerLink]="['/theory', theory(n.id)]" [attr.aria-label]="title(n.id) + ' — open the transaction'"
             (mouseenter)="hover.set(n.id)" (mouseleave)="hover.set(null)" (focus)="hover.set(n.id)" (blur)="hover.set(null)">
            <circle class="m-hit" [attr.cx]="n.x" [attr.cy]="l.y" r="14" />
            <circle class="m-node" [class.m-node-live]="live.has(n.id)" [class.m-node-on]="hover() === n.id || lane() === l.flow" [attr.cx]="n.x" [attr.cy]="l.y" r="6" />
          </a>
        }
      }
      @if (tip(); as t) {
        <g class="m-tip" aria-hidden="true">
          <rect [attr.x]="t.x" [attr.y]="t.y" [attr.width]="t.w" height="24" rx="6" />
          <text [attr.x]="t.x + 10" [attr.y]="t.y + 16">{{ t.text }}</text>
        </g>
      }
    </svg>
  `,
})
export class HeroMotif {
  protected readonly lanes = LANES;
  protected readonly live = LIVE;
  protected readonly livePath = LIVE_PATH;
  protected readonly hover = signal<string | null>(null);
  protected readonly lane = signal<string | null>(null);

  protected title(id: string) { return stepById(id)?.title ?? id; }
  protected theory(id: string) { return stepById(id)?.theory ?? ''; }

  /** Label box for the hovered step: above the node, kept inside the drawing. */
  protected readonly tip = computed(() => {
    const id = this.hover();
    if (!id) return null;
    const lane = LANES.find((l) => l.nodes.some((n) => n.id === id))!;
    const node = lane.nodes.find((n) => n.id === id)!;
    const text = this.title(id);
    const w = Math.round(text.length * 6.6 + 20);
    const x = Math.max(0, Math.min(456 - w, node.x - w / 2));
    return { text, w, x, y: lane.y + 14 };
  });
}
