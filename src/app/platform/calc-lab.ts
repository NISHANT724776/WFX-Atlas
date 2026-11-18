import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface CalcRule { id: string; version: number; status: string; title: string; module: string; txn: string; formula: string; inputs: { name: string; label: string; type: string; required: boolean; default?: number }[]; output: string; testCases: string }
interface RunResult { ruleId: string; version: number; status: string; confirmed: boolean; formula: string; expression: string; ok: boolean; result: number | null; steps: { target: string; formula: string; substituted: string; value: number }[]; inputsUsed: { label: string; value: number; defaulted: boolean }[]; warnings: string[]; errors: string[] }
interface Tests { cases: { name: string; kind: string; expect: string; pass: boolean; detail: string }[]; passed: number; failed: number }

@Component({
  selector: 'app-calc-lab',
  imports: [KbGate, KbTabs, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Calculation lab</h1>
    <kb-gate next="/calc-lab">
      <kb-tabs />
      <p class="muted small">Runs the stored rules with the deterministic calculation engine (never a language model). Rules that are not Approved or Active run as a simulation and say so.</p>
      <div class="kb-filter">
        <input type="search" placeholder="Filter rules" [value]="q()" (input)="q.set($any($event.target).value)" />
        <select [ngModel]="ruleId()" (ngModelChange)="choose($event)" name="rule"><option value="">Choose a rule…</option>@for (r of shown(); track r.id) { <option [value]="r.id">{{ r.title }} — {{ r.txn }} ({{ r.status }})</option> }</select>
      </div>
      @if (rule(); as r) {
        <section class="kb-panel kb-pad">
          <h2>{{ r.title }} <span class="kb-badge" [attr.data-s]="r.status">{{ r.status }}</span></h2>
          <p class="small muted">{{ r.id }} v{{ r.version }} · {{ r.txn }} · <a [routerLink]="['/rulebook']" [queryParams]="{ id: r.id }">open the rule</a></p>
          <p><code>{{ r.formula }}</code></p>
          <form class="kb-row" (ngSubmit)="run()">
            @for (i of r.inputs; track i.name) {
              <label>{{ i.label }}{{ i.type === 'percent' ? ' (%)' : '' }}{{ i.required ? '' : ' — optional' }}
                <input [name]="i.name" [(ngModel)]="values[i.name]" inputmode="decimal" [placeholder]="i.default !== undefined ? 'default ' + i.default : ''" />
              </label>
            }
            <button class="btn primary" type="submit">Calculate</button>
            <button class="btn" type="button" (click)="tests()">Generate and run test cases</button>
          </form>
          @if (res(); as x) {
            <div class="kb-calc">
              @if (x.ok) { <p class="kb-result">{{ rule()!.output }} = <strong>{{ x.result }}</strong></p> }
              <ol class="kb-steps">@for (s of x.steps; track $index) { <li><code>{{ s.target }} = {{ s.formula }}</code> → <code>{{ s.substituted }}</code> = <strong>{{ s.value }}</strong></li> }</ol>
              @for (w of x.warnings; track $index) { <p class="kb-warn small">{{ w }}</p> }
              @for (e of x.errors; track $index) { <p class="kb-bad small">{{ e }}</p> }
              <p class="small muted">Rule {{ x.ruleId }} v{{ x.version }} ({{ x.status }}) · inputs: @for (i of x.inputsUsed; track i.label) { {{ i.label }} {{ i.value }}{{ i.defaulted ? ' (default)' : '' }}; }</p>
            </div>
          }
          @if (t(); as tt) {
            <h3>Test cases: {{ tt.passed }} passed, {{ tt.failed }} failed</h3>
            <div class="table-scroll"><table><thead><tr><th>Kind</th><th>Case</th><th>Expected</th><th>Result</th><th></th></tr></thead>
              <tbody>@for (c of tt.cases; track $index) { <tr><td>{{ c.kind }}</td><td>{{ c.name }}</td><td>{{ c.expect }}</td><td>{{ c.detail }}</td><td>{{ c.pass ? '✔' : '✖' }}</td></tr> }</tbody></table></div>
          }
        </section>
      }
    </kb-gate>
  `,
})
export default class CalcLabPage {
  private readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  protected readonly rules = signal<CalcRule[]>([]);
  protected readonly q = signal('');
  protected readonly ruleId = signal('');
  protected readonly res = signal<RunResult | null>(null);
  protected readonly t = signal<Tests | null>(null);
  protected values: Record<string, string> = {};
  protected readonly rule = computed(() => this.rules().find((r) => r.id === this.ruleId()) ?? null);
  protected readonly shown = computed(() => { const q = this.q().toLowerCase(); return this.rules().filter((r) => !q || `${r.title} ${r.txn} ${r.id}`.toLowerCase().includes(q)); });
  constructor() {
    inject(SeoService).set({ title: 'Calculation lab', description: 'Run WFX calculation rules step by step and generate test cases.', path: '/calc-lab', noindex: true, crumbs: [{ label: 'Calculation lab', path: '/calc-lab' }] });
    effect(() => { if (this.kb.user() && !this.rules().length) void this.kb.get<{ rules: CalcRule[] }>('/calc/rules').then((r) => { this.rules.set(r.rules); const want = this.route.snapshot.queryParamMap.get('rule'); if (want) this.choose(want); }); });
  }
  protected choose(id: string) {
    this.ruleId.set(id); this.res.set(null); this.t.set(null);
    const tc = /^(.*?)(?:→|->)/.exec(this.rule()?.testCases.split('\n')[0] ?? '')?.[1] ?? '';
    this.values = Object.fromEntries(tc.split(',').map((p) => p.split('=').map((x) => x.trim())).filter((p) => p.length === 2));
  }
  protected async run() { this.res.set(await this.kb.post<RunResult>('/calc/run', { ruleId: this.ruleId(), inputs: this.values })); }
  protected async tests() { this.t.set(await this.kb.post<Tests>('/calc/tests', { ruleId: this.ruleId() })); }
}
