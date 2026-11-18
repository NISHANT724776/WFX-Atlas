import { ChangeDetectionStrategy, Component, HostListener, computed, untracked, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { FLOW_INDEX, SITE, STATIC_PAGES } from '../data/catalog';
import { PHASES, REQUIRES, SCENARIOS, STEPS, STEP_GROUPS, hasBooking, pathBetween, phaseById, stepById } from '../data/journey';
import { DEFAULT_SIM, IndentStatus, SimInput, simulate } from '../data/sim';
import { Blueprint } from '../shared/blueprint';
import { SimPanel } from '../shared/sim-panel';
import { Storyboard } from '../shared/storyboard';
import { NotFoundBody } from './not-found';
import { SectionSwitch } from '../shared/section-switch';

type View = 'blueprint' | 'story';

@Component({
  selector: 'app-workflow-builder',
  imports: [Blueprint, SimPanel, Storyboard, NotFoundBody, SectionSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (valid()) {
      <section-switch group="workflows" />
      <header class="page-head">
        <p class="eyebrow">{{ activePreset() ? 'Workflow · ' + activePreset()!.tagline : 'Workflow builder' }}</p>
        <h1>{{ activePreset()?.name ?? 'Your custom workflow' }}</h1>
        <p class="lead">Tick exactly the steps you need, from any part of WFX. Read it as a blueprint, change the scenario on the right, or
          play it screen by screen as a storyboard.</p>
      </header>

      <div class="builder-bar">
        <div class="msel" [class.open]="menuOpen()">
          <button type="button" class="msel-btn" [attr.aria-expanded]="menuOpen()" aria-haspopup="true" (click)="menuOpen.set(!menuOpen())">
            <span class="msel-label">Steps</span>
            <strong>{{ path().length }} of {{ total }} selected</strong>
            <span class="msel-caret" aria-hidden="true">▾</span>
          </button>
          @if (menuOpen()) {
            <div class="msel-panel swap-in" role="group" aria-label="Choose the steps of your workflow">
              <div class="msel-top">
                <p class="muted small">Tick or untick any step or sub-step. They always run in the order WFX works.</p>
                <p class="msel-acts"><button type="button" class="linkish small" (click)="selectAll()">Select all</button> · <button type="button" class="linkish small" (click)="resetSel()">Reset</button></p>
              </div>
              <div class="msel-list">
                @for (p of phases; track p.id) {
                  <div class="msel-group">
                    <label class="msel-head">
                      <input type="checkbox" [checked]="phaseState(p.id) === 'all'" [indeterminate]="phaseState(p.id) === 'some'" (change)="togglePhase(p.id)" />
                      <span><strong>{{ p.letter }}. {{ p.name }}</strong></span>
                    </label>
                    @for (g of groupsOf(p.id); track g.id) {
                      <div class="msel-sub">
                        <div class="msel-subhead">
                          <label>
                            <input type="checkbox" [checked]="groupState(g.id) === 'all'" [indeterminate]="groupState(g.id) === 'some'" (change)="toggleGroup(g.id)" />
                            <span>{{ g.title }}</span>
                          </label>
                          <button type="button" class="msel-exp" [attr.aria-expanded]="isOpenGroup(g.id)" [attr.aria-label]="(isOpenGroup(g.id) ? 'Hide' : 'Show') + ' steps of ' + g.title" (click)="toggleOpenGroup(g.id)">
                            <span class="muted small">{{ groupCount(g.id) }}/{{ g.steps.length }}</span><span class="msel-caret" [class.up]="isOpenGroup(g.id)" aria-hidden="true">▾</span>
                          </button>
                        </div>
                        @if (isOpenGroup(g.id)) {
                          @for (s of stepsInGroup(g.id); track s.id) {
                            <label class="msel-opt" [class.sys]="s.actor === 'system'">
                              <input type="checkbox" [checked]="isPicked(s.id)" (change)="toggleStep(s.id)" />
                              <span>{{ s.title }}</span>
                            </label>
                          }
                        }
                      </div>
                    }
                  </div>
                }
              </div>
              <div class="msel-foot"><button type="button" class="btn primary" (click)="menuOpen.set(false)">Done</button></div>
            </div>
          }
        </div>
        <div class="view-switch" role="tablist" aria-label="View">
          <button type="button" role="tab" [attr.aria-selected]="viewNow() === 'blueprint'" [class.on]="viewNow() === 'blueprint'" (click)="setView('blueprint')">Blueprint</button>
          <button type="button" role="tab" [attr.aria-selected]="viewNow() === 'story'" [class.on]="viewNow() === 'story'" (click)="setView('story')">Storyboard</button>
        </div>
      </div>
      <ol class="chain" aria-label="Your chain of steps">
        @for (c of chain(); track c.step.id; let i = $index) {
          @if (c.skipped.length) { <li class="chain-gap" [title]="'Skipped: ' + skippedNames(c.skipped)">⋯ skips {{ c.skipped.length }}</li> }
          <li class="chain-step"><span class="chain-n">{{ i + 1 }}</span>{{ c.step.title }}
            @if (path().length > 1) { <button type="button" class="chain-x" [attr.aria-label]="'Remove ' + c.step.title" (click)="toggleStep(c.step.id)">×</button> }</li>
        }
      </ol>
      @for (h of hints(); track h) { <p class="chain-hint">{{ h }}</p> }
      <section class="scen-bar" aria-label="Start from a ready-made workflow or a scenario">
        <p class="scen-row"><span class="muted small">Ready-made</span>
          @for (p of presets; track p.slug) { <button type="button" class="chip-btn" [class.on]="isSame(presetIds(p))" (click)="applyIds(presetIds(p), null)" [title]="p.description">{{ p.name }}</button> }
        </p>
        <p class="scen-row"><span class="muted small">Scenarios</span>
          @for (sc of scenarios; track sc.id) { <button type="button" class="chip-btn" [class.on]="activeScenario()?.id === sc.id" (click)="applyScenario(sc)" [title]="sc.note">{{ sc.name }}</button> }
        </p>
        @if (activeScenario(); as sc) { <p class="small scen-note"><strong>{{ sc.name }}.</strong> {{ sc.note }}</p> }
      </section>

      <p class="objective"><strong>Objective</strong> {{ objective() }}</p>

      <div class="builder-layout">
        <div class="builder-main">
          @if (viewNow() === 'blueprint') {
            <app-blueprint [steps]="path()" [result]="result()" [selected]="selected()"
                           (pick)="toggle($event)" (status)="setStatus($event)" (story)="openStory($event)" />
          } @else {
            <app-storyboard [steps]="path()" [result]="result()" [focus]="storyFocus() ?? selected()" />
          }
        </div>
        <aside class="builder-rail">
          @if (hasScenario()) { <app-sim-panel [input]="sim()" [result]="result()" (simChange)="sim.set($event)" /> }
          <details class="rail-card rail-about">
            <summary class="rail-title">About this path</summary>
            @if (keyPoints().length) {
              <p class="rail-h">Key points</p>
              <ul class="kp">@for (k of keyPoints(); track k) { <li>{{ k }}</li> }</ul>
            }
            @if (formulas().length) {
              <p class="rail-h">Formulas</p>
              @for (fo of formulas(); track fo.label) { <p class="rail-formula"><strong>{{ fo.label }}</strong><span>= {{ fo.expr }}</span></p> }
            }
            <p class="rail-h">Legend</p>
            <ul class="legend-list">
              <li><span class="lg-box user"></span>User action</li>
              <li><span class="lg-box system"></span>System process</li>
              <li><span class="lg-box pending"></span>Not reached in this scenario</li>
              <li><span class="lg-box scen"></span>Active scenario</li>
            </ul>
            <p class="rail-h">Notes</p>
            <ul class="kp small">
              <li>Adjustment is always at SKU level (Article | Colour | Size).</li>
              <li>Only available quantity is adjusted; partial adjustment is supported.</li>
              <li>Numbers: style setup from Adi TShirt (NIS-59) (live WFX), the rest from the Flannel Shirt Adi (NIS-58) trial.</li>
            </ul>
          </details>
        </aside>
      </div>
    } @else {
      <app-not-found-body />
    }
  `,
})
export default class WorkflowBuilderPage {
  /** Preset slug from /workflows/:flow (empty on /workflows). */
  readonly flow = input<string>('');
  readonly from = input<string | undefined>(undefined);
  readonly to = input<string | undefined>(undefined);
  readonly view = input<string | undefined>(undefined);
  readonly step = input<string | undefined>(undefined);
  /** Comma-separated step ids of a hand-picked workflow (?steps=style,oc,…). */
  readonly steps = input<string | undefined>(undefined);
  /** Scenario id (?scenario=): sets how far the booking got in the simulator. */
  readonly scenario = input<string | undefined>(undefined);

  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  protected readonly phases = PHASES;
  protected readonly presets = FLOW_INDEX;
  protected readonly sim = signal<SimInput>({ ...DEFAULT_SIM });
  /** Without any booking step in the chain nothing is booked, so nothing can be adjusted. */
  protected readonly result = computed(() => simulate(hasBooking(this.path()) ? this.sim() : { ...this.sim(), status: 'none' }));
  protected readonly storyFocus = signal<string | null>(null);

  protected readonly preset = computed(() => FLOW_INDEX.find((p) => p.slug === this.flow()));
  protected readonly valid = computed(() => !this.flow() || !!this.preset());
  private readonly fallback = FLOW_INDEX[0];
  protected readonly fromId = computed(() => this.known(this.from()) ?? this.preset()?.from ?? this.fallback.from);
  protected readonly toId = computed(() => this.known(this.to()) ?? this.preset()?.to ?? this.fallback.to);
  protected readonly scenarios = SCENARIOS;
  /** Steps hand-picked by the user, in WFX flow order. */
  private readonly picked = computed(() => {
    const want = new Set((this.steps() ?? '').split(',').map((x) => x.trim()).filter(Boolean));
    return STEPS.filter((s) => want.has(s.id));
  });
  /** True when the steps were chosen by hand (?steps=), false for a ready-made start-to-end range. */
  protected readonly pickMode = computed(() => this.picked().length > 0);
  /** The selected steps: the hand-picked ones, otherwise the range of the ready-made workflow. */
  protected readonly path = computed(() => (this.pickMode() ? this.picked() : pathBetween(this.fromId(), this.toId())));
  protected readonly total = STEPS.length;
  protected readonly menuOpen = signal(false);
  private readonly openGroups = signal<Set<string>>(new Set());
  protected readonly activeScenario = computed(() => {
    const sc = SCENARIOS.find((x) => x.id === this.scenario());
    return sc && this.isSame(sc.steps) ? sc : undefined;
  });
  /** The picked steps with the flow steps skipped before each of them. */
  protected readonly chain = computed(() => {
    const out: { step: (typeof STEPS)[number]; skipped: (typeof STEPS) }[] = [];
    let prev = -1;
    for (const step of this.path()) {
      const idx = STEPS.indexOf(step);
      out.push({ step, skipped: prev >= 0 && idx - prev > 1 ? STEPS.slice(prev + 1, idx) : [] });
      prev = idx;
    }
    return out;
  });
  protected readonly hints = computed(() => {
    const ids = new Set(this.path().map((s) => s.id));
    const out: string[] = [];
    for (const s of this.path()) {
      const miss = (REQUIRES[s.id] ?? []).filter((r) => !ids.has(r));
      if (miss.length) out.push(`“${s.title}” normally follows “${miss.map((m) => stepById(m)?.title).join('” and “')}”, which is not in your chain.`);
    }
    return out;
  });
  protected readonly activePreset = computed(() => (this.pickMode() ? undefined : FLOW_INDEX.find((p) => p.from === this.fromId() && p.to === this.toId())));
  protected readonly viewNow = computed<View>(() => (this.view() === 'story' ? 'story' : 'blueprint'));
  protected readonly selected = computed(() => (this.step() && this.path().some((s) => s.id === this.step()) ? this.step()! : null));

  protected readonly objective = computed(() => {
    const p = this.path();
    const ph = [...new Set(p.map((s) => s.phase))].map((id) => phaseById(id).name.toLowerCase());
    if (this.pickMode()) {
      const skipped = this.chain().reduce((a, c) => a + c.skipped.length, 0);
      return `Your own chain of ${p.length} step${p.length === 1 ? '' : 's'} across ${ph.join(', ')}${skipped ? `, leaving out ${skipped} step${skipped === 1 ? '' : 's'} in between` : ''}.`;
    }
    return `Go from “${p[0].title}” to “${p[p.length - 1].title}” in ${p.length} steps, across ${ph.join(', ')}.`;
  });
  /** The scenario simulator only matters once the path reaches the booking or sales-order phases. */
  protected readonly hasScenario = computed(() => this.path().some((s) => s.phase !== 'A') && hasBooking(this.path()));
  protected readonly keyPoints = computed(() => [...new Set(this.path().map((s) => s.keyPoint).filter((k): k is string => !!k))]);
  protected readonly formulas = computed(() => this.path().map((s) => s.formula).filter((f): f is NonNullable<typeof f> => !!f));

  constructor() {
    // arriving with ?scenario= sets how far the booking got
    effect(() => {
      const sc = SCENARIOS.find((x) => x.id === this.scenario());
      if (sc?.status) untracked(() => this.setStatus(sc.status!));
    });
    effect(() => {
      const p = this.preset();
      if (!this.valid()) {
        this.seo.set({ title: 'Page not found', description: 'This workflow does not exist in the WFX Atlas.', path: `/workflows/${this.flow()}`, noindex: true });
        return;
      }
      const path = p ? `/workflows/${p.slug}` : '/workflows';
      const base = STATIC_PAGES.find((x) => x.path === '/workflows')!;
      const steps = pathBetween(p?.from ?? this.fallback.from, p?.to ?? this.fallback.to);
      this.seo.set({
        title: p ? `${p.name} workflow` : base.title,
        description: p ? p.description : base.description,
        path,
        crumbs: this.crumbsFor(path),
        schema: [{
          '@type': 'HowTo',
          name: p ? `${p.name} workflow in WFX ERP` : 'WFX workflow',
          url: SITE.url + path,
          step: steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.title, text: typeof s.short === 'string' ? s.short : s.doc })),
        }],
      });
    });
  }

  /** Breadcrumb follows the range actually shown, not only the URL preset. */
  private crumbsFor(path: string) {
    const active = this.activePreset();
    const base = [{ label: 'Workflows', path: '/workflows' }];
    if (active) return [...base, { label: active.name, path: `/workflows/${active.slug}` }];
    return path === '/workflows' && !this.from() && !this.steps() ? base : [...base, { label: 'Custom workflow', path }];
  }

  private known(id: string | undefined): string | undefined {
    return id && STEPS.some((s) => s.id === id) ? id : undefined;
  }
  protected stepsOf(phase: string) {
    return STEPS.filter((s) => s.phase === phase);
  }
  private nav(params: Record<string, string | null>): void {
    this.router.navigate([], { queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }
  protected setSteps(ids: string[]): void {
    this.nav({ steps: ids.join(','), step: null, from: null, to: null });
  }
  protected isPicked(id: string): boolean {
    return this.path().some((s) => s.id === id);
  }
  protected toggleStep(id: string): void {
    const cur = this.path().map((s) => s.id);
    if (cur.includes(id)) {
      if (cur.length === 1) return; // keep at least one step
      this.setSteps(cur.filter((x) => x !== id));
    } else this.setSteps([...cur, id]);
  }
  protected phaseState(phase: string): 'all' | 'some' | 'none' {
    const ids = this.stepsOf(phase).map((s) => s.id);
    const n = ids.filter((id) => this.isPicked(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  }
  protected togglePhase(phase: string): void {
    const cur = new Set(this.path().map((s) => s.id));
    const on = this.phaseState(phase) !== 'all';
    for (const s of this.stepsOf(phase)) on ? cur.add(s.id) : cur.delete(s.id);
    if (cur.size) this.setSteps([...cur]);
  }
  protected selectAll(): void { this.setSteps(STEPS.map((s) => s.id)); }
  protected groupsOf(phase: string) { return STEP_GROUPS.filter((g) => g.phase === phase); }
  protected stepsInGroup(id: string) { return STEP_GROUPS.find((g) => g.id === id)!.steps.map((x) => stepById(x)!).filter(Boolean); }
  protected groupCount(id: string): number { return STEP_GROUPS.find((g) => g.id === id)!.steps.filter((x) => this.isPicked(x)).length; }
  protected groupState(id: string): 'all' | 'some' | 'none' {
    const n = this.groupCount(id), t = STEP_GROUPS.find((g) => g.id === id)!.steps.length;
    return n === 0 ? 'none' : n === t ? 'all' : 'some';
  }
  protected toggleGroup(id: string): void {
    const cur = new Set(this.path().map((s) => s.id));
    const on = this.groupState(id) !== 'all';
    for (const x of STEP_GROUPS.find((g) => g.id === id)!.steps) on ? cur.add(x) : cur.delete(x);
    if (cur.size) this.setSteps([...cur]);
  }
  protected isOpenGroup(id: string): boolean { return this.openGroups().has(id) || this.groupState(id) === 'some'; }
  protected toggleOpenGroup(id: string): void {
    this.openGroups.update((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  // ── ready-made workflows and scenarios ──
  protected presetIds(p: (typeof FLOW_INDEX)[number]): string[] { return pathBetween(p.from, p.to).map((x) => x.id); }
  protected isSame(ids: string[]): boolean {
    const cur = this.path().map((s) => s.id);
    return cur.length === ids.length && ids.every((x) => cur.includes(x));
  }
  protected applyIds(ids: string[], scenario: string | null): void {
    this.nav({ steps: ids.join(','), scenario, step: null, from: null, to: null });
  }
  protected applyScenario(sc: (typeof SCENARIOS)[number]): void {
    if (sc.status) this.setStatus(sc.status);
    this.applyIds(sc.steps, sc.id);
  }
  protected resetSel(): void { this.nav({ steps: null, step: null, from: null, to: null }); }
  @HostListener('document:click', ['$event'])
  protected onDocClick(e: Event): void {
    if (this.menuOpen() && !(e.target as HTMLElement).closest('.msel')) this.menuOpen.set(false);
  }
  @HostListener('document:keydown.escape')
  protected onEsc(): void { this.menuOpen.set(false); }
  protected skippedNames(list: typeof STEPS): string {
    return list.map((s) => s.title).join(', ');
  }
  protected setView(v: View): void {
    this.storyFocus.set(v === 'story' ? this.selected() : null);
    this.nav({ view: v === 'story' ? 'story' : null });
  }
  protected toggle(id: string): void {
    this.nav({ step: this.selected() === id ? null : id });
  }
  protected setStatus(s: IndentStatus): void {
    this.sim.update((x) => ({ ...x, status: s, progressPct: s === 'po' || s === 'none' ? x.progressPct : x.progressPct || 100 }));
  }
  protected openStory(id: string): void {
    this.storyFocus.set(id);
    this.nav({ view: 'story', step: id });
  }
}
