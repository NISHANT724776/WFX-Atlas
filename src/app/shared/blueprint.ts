import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ADJUST_SCENARIOS, JStep, PHASES, val } from '../data/journey';
import { IndentStatus, SimResult } from '../data/sim';
import { txnBySlug } from '../data/transactions';
import { Icon } from './icon';

const RANK: Record<IndentStatus, number> = { none: 0, po: 1, asn: 2, grn: 3 };

import { StepMarker } from './states';
@Component({
  selector: 'app-blueprint',
  imports: [RouterLink, Icon, StepMarker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (g of groups(); track g.phase.id) {
      <section class="bp-phase" [style.--d]="$index">
        <div class="bp-tile">
          <span class="bp-letter">{{ g.phase.letter }}</span>
          <span class="bp-name">{{ g.phase.name }}</span>
          <span class="bp-src">{{ g.phase.source }}</span>
        </div>
        <div class="bp-body">
          <ol class="bp-steps">
            @for (s of g.steps; track s.step.id) {
              @if (!s.step.scenario) {
                <li [class.sel]="s.step.id === selected()" [class.pending]="isPending(s.step)" [class.system]="s.step.actor === 'system'" [style.--i]="s.n">
                  <button type="button" class="bp-card" (click)="pick.emit(s.step.id)" [attr.aria-expanded]="s.step.id === selected()" [attr.aria-controls]="'bp-detail-' + g.phase.id">
                    <span class="bp-n">{{ s.n }}</span>
                    <wfx-step-marker class="bp-actor" [actor]="s.step.actor" [size]="16" [showLabel]="true" />
                    <app-icon [name]="s.step.icon" [size]="30" />
                    <strong class="bp-title">{{ s.step.title }}</strong>
                    <span class="bp-short">{{ v(s.step.short) }}</span>
                    @if (isPending(s.step)) { <span class="bp-state">Not reached in this scenario</span> }
                  </button>
                </li>
              }
            }
          </ol>

          @for (s of g.steps; track s.step.id) {
            @if (s.step.scenario) {
              <div class="bp-scenarios" [class.sel]="s.step.id === selected()">
                <button type="button" class="bp-scen-head" (click)="pick.emit(s.step.id)">
                  <span class="bp-n">{{ s.n }}</span>
                  <strong>{{ s.step.title }} in the Sales Order Indent, based on the Adhoc Indent status</strong>
                  <span class="muted small">Click a scenario to simulate it</span>
                </button>
                <div class="scen-grid">
                  @for (sc of scenarios; track sc.status) {
                    <button type="button" class="scen" [class.on]="sc.status === result().input.status" (click)="status.emit(sc.status)" [attr.aria-pressed]="sc.status === result().input.status">
                      <span class="scen-title">{{ sc.title }}</span>
                      <ul class="scen-cond">@for (c of sc.conditions; track c) { <li>{{ c }}</li> }</ul>
                      <span class="mini-flow" aria-hidden="true">
                        @for (d of docs; track d.id; let last = $last) {
                          <span class="mf" [class]="'mf ' + docState(d.id, sc.status)"><app-icon [name]="d.icon" [size]="16" />{{ d.label }}</span>
                          @if (!last) { <span class="mf-arrow">→</span> }
                        }
                      </span>
                      <span class="scen-type">{{ sc.type }}@if (sc.confirm) { <em> · to confirm</em> }</span>
                      <span class="scen-text">{{ sc.text }}</span>
                    </button>
                  }
                </div>
                <p class="scen-result">
                  @if (!result().input.linked) { Booking not linked to the sales order – nothing is adjusted. }
                  @else { <strong>{{ result().adjType }}:</strong> {{ f(result().adjusted) }} KG adjusted · {{ f(result().toBuy) }} KG still to buy }
                </p>
              </div>
            }
          }

          @if (selectedIn(g.phase.id); as d) {
            <div class="bp-detail" [id]="'bp-detail-' + g.phase.id">
              @for (k of [d.step.id]; track k) {
                <div class="swap-in">
                  <div class="bpd-head">
                    <span class="bp-n big">{{ d.n }}</span>
                    <div>
                      <p class="eyebrow">{{ d.step.actor === 'user' ? 'User action' : 'System process' }} · {{ d.step.doc }}</p>
                      <h3 class="bpd-title">{{ d.step.title }}</h3>
                    </div>
                    <button type="button" class="bpd-close" (click)="pick.emit(d.step.id)" aria-label="Close details">×</button>
                  </div>
                  <p class="bpd-short">{{ v(d.step.short) }}</p>
                  <div class="bpd-grid">
                    <div>
                      <ul class="bpd-points">@for (p of d.step.points; track $index) { <li>{{ v(p) }}</li> }</ul>
                      @if (d.step.facts) {
                        <dl class="facts">@for (fa of d.step.facts; track fa.label) { <div><dt>{{ fa.label }}</dt><dd>{{ v(fa.value) }}</dd></div> }</dl>
                      }
                    </div>
                    @if (d.step.formula; as fo) {
                      <div class="formula-mini">
                        <strong>{{ fo.label }}</strong>
                        <code>= {{ fo.expr }}</code>
                        @if (fo.note) { <span class="small">{{ fo.note }}</span> }
                      </div>
                    }
                  </div>
                  @if (d.step.table; as tb) {
                    <div class="table-scroll bpd-table">
                      <table>
                        <thead><tr>@for (c of tb.columns; track c) { <th scope="col">{{ c }}</th> }</tr></thead>
                        <tbody>@for (row of tb.rows(result()); track $index) { <tr>@for (c of row; track $index) { <td>{{ c }}</td> }</tr> }</tbody>
                      </table>
                    </div>
                  }
                  <div class="sd-actions">
                    <a class="btn primary" [routerLink]="['/theory', d.step.theory]">Read the theory: {{ theoryName(d.step.theory) }}</a>
                    <button type="button" class="btn" (click)="story.emit(d.step.id)">See it on screen</button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class Blueprint {
  readonly steps = input.required<JStep[]>();
  readonly result = input.required<SimResult>();
  readonly selected = input<string | null>(null);
  readonly pick = output<string>();
  readonly status = output<IndentStatus>();
  readonly story = output<string>();

  protected readonly scenarios = ADJUST_SCENARIOS;
  protected readonly docs = [
    { id: 'adhoc', label: 'Adhoc Indent', icon: 'doc' }, { id: 'po', label: 'PO', icon: 'cart' },
    { id: 'asn', label: 'ASN', icon: 'truck' }, { id: 'grn', label: 'GRN', icon: 'box' },
  ];

  protected readonly groups = computed(() => {
    const numbered = this.steps().map((step, i) => ({ step, n: i + 1 }));
    return PHASES.map((phase) => ({ phase, steps: numbered.filter((s) => s.step.phase === phase.id) })).filter((g) => g.steps.length);
  });

  protected selectedIn(phase: string) {
    return this.groups().find((g) => g.phase.id === phase)?.steps.find((s) => s.step.id === this.selected());
  }
  protected isPending(s: JStep): boolean {
    return !!s.needs && RANK[this.result().input.status] < RANK[s.needs];
  }
  protected docState(doc: string, status: IndentStatus): string {
    if (doc === 'adhoc') return 'done';
    const r = RANK[doc as IndentStatus];
    return RANK[status] >= r ? 'done' : 'wait';
  }
  protected v(x: Parameters<typeof val>[0]): string {
    return val(x, this.result());
  }
  protected f(n: number): string {
    return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  protected theoryName(slug: string): string {
    return txnBySlug(slug)?.name ?? slug;
  }
}
