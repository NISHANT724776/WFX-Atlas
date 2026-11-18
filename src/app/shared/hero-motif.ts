// The homepage motif: three WFX journeys as lanes on a 24px grid, steps as nodes, and the documented links between
// lanes as dashed connectors. One connector is the accent: a Buyer Block Booking is linked to the Sales Order, the
// moment that changes what is still to buy. Static by design (motion arrives with the motion group, on hover only).
import { ChangeDetectionStrategy, Component } from '@angular/core';

interface Lane { name: string; y: number; nodes: number[] }
const LANES: Lane[] = [
  { name: 'Style setup', y: 48, nodes: [24, 144, 264] },
  { name: 'Buyer Block Booking', y: 144, nodes: [48, 168, 336] },
  { name: 'Sales Order', y: 240, nodes: [72, 240, 336, 432] },
];

@Component({
  selector: 'wfx-hero-motif',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg class="wfx-motif" viewBox="0 0 456 264" role="img" aria-labelledby="wfx-motif-t">
      <title id="wfx-motif-t">Three WFX journeys and how they connect: the approved BOM feeds the booking, and the booking is linked to the sales order.</title>
      @for (l of lanes; track l.name) {
        <text class="m-label" x="0" [attr.y]="l.y - 16">{{ l.name }}</text>
        <path class="m-lane" [attr.d]="'M0 ' + l.y + 'H456'" />
      }
      <!-- the approved BOM is selected on the booking -->
      <path class="m-link" d="M144 48C144 96 168 96 168 144" />
      <!-- the booking is linked to the sales order: the live link -->
      <path class="m-link m-live" d="M336 144V240" />
      @for (l of lanes; track l.name) {
        @for (x of l.nodes; track x) {
          <circle class="m-node" [class.m-node-live]="(l.y === 144 || l.y === 240) && x === 336" [attr.cx]="x" [attr.cy]="l.y" r="6" />
        }
      }
    </svg>
  `,
})
export class HeroMotif {
  protected readonly lanes = LANES;
}
