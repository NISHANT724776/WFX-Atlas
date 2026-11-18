import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, PLATFORM_ID, afterRenderEffect, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { STATIC_PAGES } from '../data/catalog';
import { calcById } from '../data/calculations';
import { Cell, Col, ColType, DOCS, Dependency, Doc, EMPTY_VALUES, Grid, Row, Shot, consumers, dependencyFor, docById } from '../data/docs';
import { DOC_ICON, MODULES, moduleById, moduleOfDoc } from '../data/modules';
import { Icon } from '../shared/icon';
import { SectionSwitch } from '../shared/section-switch';

type TabId = 'overview' | 'data' | 'calc' | 'flows' | 'screen';

const TYPE_LABEL: Record<ColType, string> = { key: 'Key', entered: 'Entered by user', calc: 'Calculated by WFX', link: 'Link to another document', copied: 'Copied from another document' };
const GROUPS: { id: string; label: string; types: ColType[] }[] = [
  { id: 'entered', label: 'You enter', types: ['entered'] },
  { id: 'calc', label: 'WFX calculates', types: ['calc'] },
  { id: 'from', label: 'Comes from another document', types: ['link', 'copied'] },
  { id: 'key', label: 'Identifies the row', types: ['key'] },
];

@Component({
  selector: 'app-data-model',
  imports: [RouterLink, Icon, SectionSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section-switch group="data" />
    <header class="page-head">
      <p class="eyebrow">Data model</p>
      <h1>See how the data <em>moves</em></h1>
      <p class="lead">Pick a module, then a document. Everything else opens only when you ask for it.</p>
    </header>

    <!-- LEVEL 1 · modules -->
    <nav class="dm-modules" aria-label="Modules">
      @for (m of modules; track m.id; let i = $index) {
        <button type="button" class="dm-mod" [class.on]="m.id === module()?.id" [attr.aria-pressed]="m.id === module()?.id" [style.--i]="i" (click)="pickModule(m.id)">
          <span class="dm-mod-ic"><app-icon [name]="m.icon" [size]="26" /></span>
          <strong>{{ m.name }}</strong>
          <span class="dm-mod-n">{{ m.docs.length }} {{ m.docs.length === 1 ? 'document' : 'documents' }}</span>
        </button>
        @if (i < modules.length - 1) { <span class="dm-mod-link" aria-hidden="true"></span> }
      }
    </nav>

    @if (!module()) {
      <p class="dm-hint swap-in"><span class="dm-pulse"></span>Tap a module above to see its documents and how data flows between them.</p>
    }

    <!-- LEVEL 2 · documents of the module, as an animated flow -->
    @if (module(); as mod) {
      <section class="dm-map swap-in" [attr.aria-label]="mod.name + ' documents'">
        <div class="dm-map-head">
          <div>
            <h2 class="dm-map-title">{{ mod.name }}</h2>
            <p class="muted small">{{ mod.blurb }} · {{ mod.docs.length }} {{ mod.docs.length === 1 ? 'document' : 'documents' }}, in the order data flows</p>
          </div>
          @if (mod.docs.length > 1) {
            <button type="button" class="btn" (click)="togglePlay()">{{ playing() ? '■ Stop' : '▶ Play the flow' }}</button>
          }
        </div>
        <ol class="dm-nodes">
          @for (d of modDocs(); track d.id; let i = $index) {
            <li class="dm-item" [style.--i]="i">
              <button type="button" class="dm-node" [class.on]="doc()?.id === d.id" [class.playing]="playIdx() === i" [class.rel-in]="relation(d.id) === 'in'" [class.rel-out]="relation(d.id) === 'out'"
                      [attr.aria-pressed]="doc()?.id === d.id" (click)="pickDoc(d.id)">
                <span class="dm-node-ic"><app-icon [name]="iconOf(d.id)" [size]="24" /></span>
                <strong>{{ d.name }}</strong>
                <span class="dm-node-meta">{{ stats(d).fields }} fields · {{ stats(d).calc }} calculated</span>
                @if (relation(d.id) === 'in') { <span class="dm-tag">feeds this</span> }
                @if (relation(d.id) === 'out') { <span class="dm-tag">reads this</span> }
              </button>
              @if (i < modDocs().length - 1) { <span class="dm-link" [class.playing]="playIdx() === i" aria-hidden="true"></span> }
            </li>
          }
        </ol>
        @if (playing() && caption(); as c) { <p class="dm-caption swap-in" aria-live="polite">{{ c }}</p> }
      </section>
    }

    <!-- LEVEL 3 · one document, opened piece by piece -->
    @if (doc(); as d) {
      @for (k of [d.id]; track k) {
        <article class="dm-detail swap-in" aria-label="Document detail">
          <header class="dm-detail-head">
            <span class="dm-detail-ic"><app-icon [name]="iconOf(d.id)" [size]="28" /></span>
            <div>
              <p class="eyebrow">{{ module()?.name }}</p>
              <h2 class="dm-detail-title">{{ d.name }}</h2>
              <p class="dm-detail-sum">{{ firstSentence(d.summary) }}</p>
            </div>
            <button type="button" class="dm-x" (click)="closeDoc()" aria-label="Close document">×</button>
          </header>

          <div class="dm-tabs" role="tablist" aria-label="What to show">
            @for (t of tabsFor(d); track t.id) {
              <button type="button" role="tab" class="dm-tab" [class.on]="tab() === t.id" [attr.aria-selected]="tab() === t.id" (click)="setTab(t.id)">
                <app-icon [name]="t.icon" [size]="18" />{{ t.label }}@if (t.count) { <span class="dm-tab-n">{{ t.count }}</span> }
              </button>
            }
          </div>

          @switch (tab()) {
            @case ('overview') {
              <div class="dm-pane swap-in">
                <p>{{ d.summary }}</p>
                <dl class="doc-facts">
                  <div><dt>Screen</dt><dd>{{ d.screen }}</dd></div>
                  @for (h of filledHeader(); track h.label) {
                    <div><dt>{{ h.label }}</dt><dd>
                      @if (h.from) { <button type="button" class="wfx-link" (click)="pickDoc(h.from.doc)">{{ h.value }}</button> } @else { {{ h.value }} }
                    </dd></div>
                  }
                </dl>
                <p class="dm-sub">Fields at a glance <span class="muted small">(tap one to see it in the data)</span></p>
                @for (g of fieldGroups(); track g.id) {
                  <div class="dm-fg">
                    <p class="dm-fg-title"><i [class]="'dot t-' + g.types[0]"></i>{{ g.label }} <span class="muted small">{{ g.cols.length }}</span></p>
                    <p class="dm-chips">
                      @for (c of (showAll() ? g.cols : g.cols.slice(0, 8)); track c.col.key) {
                        <button type="button" class="dm-chip" (click)="openCol(c.grid, c.col)">{{ c.col.label }}</button>
                      }
                      @if (!showAll() && g.cols.length > 8) { <button type="button" class="dm-chip more" (click)="showAll.set(true)">+{{ g.cols.length - 8 }} more</button> }
                    </p>
                  </div>
                }
                @if (d.theory) { <a class="dm-more" [routerLink]="['/theory', d.theory]">Read the theory →</a> }
              </div>
            }

            @case ('data') {
              <div class="dm-pane swap-in">
                @if (d.tabs || d.subtabs) {
                  <nav class="doc-parts" aria-label="Parts of this document">
                    @for (t of parts(); track t.doc) { <button type="button" [class.on]="t.doc === d.id" (click)="pickDoc(t.doc, 'data')">{{ t.label }}</button> }
                  </nav>
                }
                @for (g of d.grids; track g.id) {
                  <div class="wfx-grid">
                    <div class="grid-head">
                      <p class="wfx-grid-title">{{ g.title }}</p>
                      @if (hiddenCols(g).length) {
                        <button type="button" class="linkish small" (click)="toggleEmpty(g)">{{ showEmpty().has(g.id) ? 'Hide' : 'Show' }} {{ hiddenCols(g).length }} empty {{ hiddenCols(g).length === 1 ? 'column' : 'columns' }}</button>
                      }
                    </div>
                    <div class="table-scroll" tabindex="0" [attr.aria-label]="g.title + ' (scrollable)'">
                      <table class="wfx-table">
                        <thead>
                          <tr>
                            @for (c of visibleCols(g); track c.key) {
                              <th scope="col" [class.num]="c.num" [class.c-on]="isCol(g, c)" [class.c-src]="isSrc(g, c)">
                                <button type="button" (click)="pickCol(g, c)" [attr.aria-pressed]="isCol(g, c)"><i [class]="'dot t-' + c.type" aria-hidden="true"></i>{{ c.label }}</button>
                              </th>
                            }
                          </tr>
                        </thead>
                        <tbody>
                          @for (row of g.rows; track $index; let ri = $index) {
                            @if (g.group && (ri === 0 || g.rows[ri - 1][g.group] !== row[g.group])) {
                              <tr class="wfx-group"><td [attr.colspan]="visibleCols(g).length">{{ row[g.group] }}</td></tr>
                            }
                            <tr [class.r-hit]="isHitRow(row)" [class.r-dep]="depRow() === ri && !!dep()">
                              @for (c of visibleCols(g); track c.key) {
                                <td [class.num]="c.num" [class.c-on]="isCol(g, c)" [class.c-src]="isSrc(g, c)">
                                  @if (c.dep) {
                                    <button type="button" class="dep-btn" [class.on]="dep() === c.dep && depRow() === ri" (click)="openDep(c.dep, ri, row)">{{ show(row[c.key]) }} ▸</button>
                                  } @else if (c.type === 'link' && c.from && row[c.key] !== '—') {
                                    <button type="button" class="wfx-link" (click)="follow(c, row[c.key])">{{ show(row[c.key]) }}</button>
                                  } @else { {{ show(row[c.key]) }} }
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>

                    @if (depInfo(); as dp) {
                      <div class="dep-card swap-in" aria-live="polite">
                        <div class="cc-head">
                          <strong>{{ dp.kind === 'color' ? 'Colour' : 'Size' }} dependency · line {{ depLine()?.['line'] }} · {{ depLine()?.['article'] }} {{ depLine()?.['name'] }}</strong>
                          <button type="button" class="bpd-close" (click)="closeDep()" aria-label="Close dependency">×</button>
                        </div>
                        <ol class="dep-flow">
                          <li><span class="dep-step">1 · Master</span><strong>{{ dp.master }}</strong><em>{{ dp.masterCount }} {{ dp.kind === 'color' ? 'colours' : 'sizes' }}</em></li>
                          <li><span class="dep-step">2 · Article</span><strong>Adi TShirt (NIS-59) · {{ count(dp, 'onArticle') }}</strong><em>{{ dp.kind === 'color' ? 'colours' : 'sizes' }} in its base list</em></li>
                          <li><span class="dep-step">3 · BOM line {{ dp.article }}</span><strong>{{ count(dp, 'mapped') }} used · {{ count(dp, 'not-used') }} not used</strong><em>Dependency type {{ dp.type }}@if (!dp.complete) { · popup not captured }</em></li>
                        </ol>
                        <div class="dep-grid">
                          <div class="table-scroll">
                            <table class="dep-table">
                              <thead><tr><th scope="col">{{ dp.kind === 'color' ? 'Colour' : 'Size' }} (master)</th><th scope="col">On Adi TShirt</th><th scope="col">{{ dp.kind === 'color' ? 'Colour' : 'Size' }} of {{ dp.article }}</th></tr></thead>
                              <tbody>
                                @for (r of dp.rows; track r.code) {
                                  <tr [class]="'st-' + r.status">
                                    <td>@if (r.hex) { <span class="swatch" [style.background]="r.hex" aria-hidden="true"></span> } {{ r.label }}</td>
                                    <td>{{ r.onArticle ? 'Yes' : 'No' }}</td>
                                    <td>
                                      @switch (r.status) {
                                        @case ('mapped') { <span class="dep-arrow">→</span> @if (r.materialHex) { <span class="swatch" [style.background]="r.materialHex" aria-hidden="true"></span> } {{ r.material }} }
                                        @case ('not-used') { <span class="dep-tag">[Not Used]</span> }
                                        @case ('not-captured') { <span class="muted">Not captured for this line</span> }
                                        @default { <span class="muted">—</span> }
                                      }
                                    </td>
                                  </tr>
                                }
                              </tbody>
                            </table>
                          </div>
                          @if (dp.shot; as sh) { <button type="button" class="shot dep-shot" (click)="open(sh)"><img [src]="sh.src" [alt]="sh.alt" loading="lazy" width="450" height="380" /></button> }
                        </div>
                        <p class="cc-note">{{ dp.note }}</p>
                      </div>
                    }

                    @if (colInfo(g); as ci) {
                      <div class="col-card swap-in">
                        <div class="cc-head">
                          <strong>{{ ci.col.label }}</strong>
                          <span class="cc-type"><i [class]="'dot t-' + ci.col.type"></i>{{ typeLabel[ci.col.type] }}</span>
                        </div>
                        @if (ci.formula) { <code class="cc-formula">{{ ci.col.label }} = {{ ci.formula }}</code> }
                        @if (ci.uses.length) { <p class="cc-line">Calculated from @for (u of ci.uses; track u.key) { <button type="button" class="chip-btn" (click)="pickCol(g, u)">{{ u.label }}</button> }</p> }
                        @if (ci.col.from; as f) {
                          <p class="cc-line">{{ ci.col.type === 'link' ? 'Points to' : 'Comes from' }}
                            <button type="button" class="chip-btn" (click)="goCol(f.doc, f.col)">{{ docName(f.doc) }} › {{ colLabel(f.doc, f.col) }}</button></p>
                        }
                        @if (ci.example) { <p class="cc-note">{{ ci.example }}</p> }
                        @if (ci.col.note) { <p class="cc-note">{{ ci.col.note }}</p> }
                        @if (ci.usedBy.length) { <p class="cc-line">Used next in @for (u of ci.usedBy; track $index) { <button type="button" class="chip-btn" (click)="goCol(u.doc.id, u.col.key)">{{ u.doc.name }} › {{ u.col.label }}</button> }</p> }
                      </div>
                    }
                  </div>
                }
                <p class="wfx-hint">Tap a column heading to see how WFX fills it. Blue values jump to the document they come from.</p>
              </div>
            }

            @case ('calc') {
              <div class="dm-pane swap-in">
                @for (c of calcList(); track c.col.key + c.grid.id) {
                  <div class="dm-calc">
                    <p class="dm-calc-name"><i class="dot t-calc"></i>{{ c.col.label }}</p>
                    @if (c.formula) { <code class="cc-formula">{{ c.formula }}</code> }
                    @if (c.uses.length) { <p class="cc-line">From @for (u of c.uses; track u.key) { <button type="button" class="chip-btn" (click)="openCol(c.grid, u)">{{ u.label }}</button> }</p> }
                    @if (c.example) { <p class="cc-note">{{ c.example }}</p> }
                  </div>
                } @empty {
                  <p class="muted">Nothing is calculated here. Every value is entered by the user or copied from another document.</p>
                }
              </div>
            }

            @case ('flows') {
              <div class="dm-pane swap-in">
                <div class="dm-flows">
                  <div class="dm-fcol">
                    <p class="dm-sub">Reads from</p>
                    @for (f of inputs(); track f.id) {
                      <button type="button" class="dm-fnode" (click)="pickDoc(f.id, 'flows')"><strong>{{ f.name }}</strong><span>{{ f.labels }}</span></button>
                    } @empty { <p class="muted small">Starts here: nothing feeds this document.</p> }
                  </div>
                  <div class="dm-fmid" aria-hidden="true"><span class="dm-link wide"></span></div>
                  <div class="dm-fcol dm-fthis"><span class="dm-node-ic"><app-icon [name]="iconOf(d.id)" [size]="26" /></span><strong>{{ d.name }}</strong></div>
                  <div class="dm-fmid" aria-hidden="true"><span class="dm-link wide"></span></div>
                  <div class="dm-fcol">
                    <p class="dm-sub">Feeds</p>
                    @for (f of flowsTo(); track f.id) {
                      <button type="button" class="dm-fnode" (click)="pickDoc(f.id, 'flows')"><strong>{{ f.name }}</strong><span>{{ f.labels }}</span></button>
                    } @empty { <p class="muted small">Ends here: no other document reads this one.</p> }
                  </div>
                </div>
              </div>
            }

            @case ('screen') {
              <div class="dm-pane swap-in">
                <div class="shots">
                  @for (s of d.shots; track s.src) {
                    <button type="button" class="shot" (click)="open(s)"><img [src]="s.src" [alt]="s.alt" loading="lazy" decoding="async" width="640" height="360" /></button>
                  }
                </div>
                <p class="small muted">Captured from WFX QA for Adi TShirt (NIS-59). Tap to enlarge.</p>
              </div>
            }
          }
        </article>
      }
    }

    <dialog #lightbox class="lightbox" (click)="close()" (keydown.escape)="close()">
      @if (zoom(); as z) {
        <img [src]="z.src" [alt]="z.alt" />
        <p>{{ z.alt }}</p>
      }
      <button type="button" class="lb-close" (click)="close()" aria-label="Close">×</button>
    </dialog>
  `,
})
export default class DataModelPage implements OnDestroy {
  /** Query parameters: ?module= ?doc= ?tab= ?col= (highlight a column) ?find=&by= (highlight rows). */
  readonly docParam = input<string | undefined>(undefined, { alias: 'doc' });
  readonly moduleParam = input<string | undefined>(undefined, { alias: 'module' });
  readonly tabParam = input<string | undefined>(undefined, { alias: 'tab' });
  readonly col = input<string | undefined>(undefined);
  readonly find = input<string | undefined>(undefined);
  readonly by = input<string | undefined>(undefined);

  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly lightbox = viewChild<ElementRef<HTMLDialogElement>>('lightbox');
  private readonly host = inject(ElementRef);

  protected readonly modules = MODULES.filter((m) => m.docs.length);
  protected readonly typeLabel = TYPE_LABEL;
  protected readonly zoom = signal<Shot | null>(null);
  protected readonly showAll = signal(false);
  private readonly picked = signal<{ grid: string; col: string } | null>(null);

  protected readonly doc = computed<Doc | null>(() => docById(this.docParam() ?? '') ?? null);
  protected readonly module = computed(() => {
    const d = this.doc();
    return (d && moduleOfDoc(d.id)) ?? moduleById(this.moduleParam()) ?? null;
  });
  protected readonly modDocs = computed(() => (this.module()?.docs ?? []).map((id) => docById(id)!).filter(Boolean));
  protected readonly tab = computed<TabId>(() => {
    const t = this.tabParam() as TabId | undefined;
    const d = this.doc();
    if (d && t && this.tabsFor(d).some((x) => x.id === t)) return t;
    return this.col() || this.find() ? 'data' : 'overview';
  });
  protected iconOf(id: string) { return DOC_ICON[id] ?? 'doc'; }
  protected firstSentence(s: string) { const m = /^.*?[.!?](\s|$)/.exec(s); return m ? m[0].trim() : s; }
  protected stats(d: Doc) {
    const cols = d.grids.flatMap((g) => g.cols);
    return { fields: cols.length, calc: cols.filter((c) => c.type === 'calc').length };
  }

  // ── relations between documents ─────────────────────────────────────
  protected readonly flowsTo = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const groups = new Map<string, { id: string; name: string; cols: Col[] }>();
    for (const c of consumers(d.id)) {
      const g = groups.get(c.doc.id) ?? { id: c.doc.id, name: c.doc.name, cols: [] };
      if (!g.cols.some((x) => x.key === c.col.key)) g.cols.push(c.col);
      groups.set(c.doc.id, g);
    }
    return [...groups.values()].map((g) => ({ ...g, labels: g.cols.map((c) => c.label).join(' · ') }));
  });
  protected readonly inputs = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const groups = new Map<string, { id: string; name: string; labels: Set<string> }>();
    for (const g of d.grids) for (const c of g.cols) {
      if (!c.from || c.from.doc === d.id) continue;
      const e = groups.get(c.from.doc) ?? { id: c.from.doc, name: docById(c.from.doc)?.name ?? c.from.doc, labels: new Set<string>() };
      e.labels.add(this.colLabel(c.from.doc, c.from.col));
      groups.set(c.from.doc, e);
    }
    return [...groups.values()].map((g) => ({ id: g.id, name: g.name, labels: [...g.labels].join(' · ') }));
  });
  protected relation(id: string): 'in' | 'out' | null {
    if (!this.doc() || id === this.doc()!.id) return null;
    if (this.inputs().some((x) => x.id === id)) return 'in';
    if (this.flowsTo().some((x) => x.id === id)) return 'out';
    return null;
  }

  // ── tabs ────────────────────────────────────────────────────────────
  protected tabsFor(d: Doc): { id: TabId; label: string; icon: string; count?: number }[] {
    const calc = d.grids.flatMap((g) => g.cols).filter((c) => c.type === 'calc').length;
    const tabs: { id: TabId; label: string; icon: string; count?: number }[] = [
      { id: 'overview', label: 'Overview', icon: 'list' },
      { id: 'data', label: 'Data', icon: 'table' },
      { id: 'calc', label: 'Calculations', icon: 'calc', count: calc || undefined },
      { id: 'flows', label: 'Data flow', icon: 'route' },
    ];
    if (d.shots?.length) tabs.push({ id: 'screen', label: 'WFX screen', icon: 'doc', count: d.shots.length });
    return tabs;
  }
  protected readonly fieldGroups = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const seen = new Set<string>();
    const all = d.grids.flatMap((g) => g.cols.map((col) => ({ grid: g, col })));
    return GROUPS.map((gr) => ({
      ...gr,
      cols: all.filter((x) => gr.types.includes(x.col.type) && !seen.has(x.col.label) && (seen.add(x.col.label), true)),
    })).filter((g) => g.cols.length);
  });
  protected readonly calcList = computed(() => {
    const d = this.doc();
    if (!d) return [];
    return d.grids.flatMap((g) => g.cols.filter((c) => c.type === 'calc').map((col) => {
      const calc = col.calc ? calcById(col.calc) : undefined;
      return {
        grid: g, col,
        formula: col.formula ?? calc?.formula.replace(/^[^=]*=\s*/, ''),
        example: calc?.example,
        uses: (col.uses ?? []).map((u) => g.cols.find((c) => c.key === u)!).filter(Boolean),
      };
    }));
  });

  // ── play the flow ───────────────────────────────────────────────────
  protected readonly playing = signal(false);
  protected readonly playIdx = signal(-1);
  private timer: ReturnType<typeof setInterval> | null = null;
  protected readonly caption = computed(() => {
    const i = this.playIdx(), docs = this.modDocs();
    if (i < 0 || !docs[i]) return '';
    const cur = docs[i], nxt = docs[i + 1];
    if (!nxt) return `${i + 1}. ${cur.name} – the end of this flow.`;
    const passed = nxt.grids.flatMap((g) => g.cols).filter((c) => c.from?.doc === cur.id).map((c) => c.label);
    const uniq = [...new Set(passed)].slice(0, 4);
    return `${i + 1}. ${cur.name} → ${nxt.name}${uniq.length ? `: passes ${uniq.join(', ')}` : ''}`;
  });
  protected togglePlay(): void {
    if (this.playing()) return this.stop();
    if (!this.browser) return;
    this.playing.set(true);
    this.playIdx.set(0);
    this.timer = setInterval(() => {
      const next = this.playIdx() + 1;
      if (next >= this.modDocs().length) this.stop(); else this.playIdx.set(next);
    }, 1700);
  }
  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.playing.set(false);
    this.playIdx.set(-1);
  }
  ngOnDestroy(): void { this.stop(); }

  /** Column selected by click, or by ?col= when arriving from another document. */
  private readonly active = computed(() => {
    const p = this.picked();
    if (p) return p;
    const c = this.col();
    const d = this.doc();
    if (!c || !d) return null;
    const g = d.grids.find((x) => x.cols.some((k) => k.key === c));
    return g ? { grid: g.id, col: c } : null;
  });

  constructor() {
    inject(SeoService).set({ ...STATIC_PAGES.find((p) => p.path === '/data-model')!, crumbs: [{ label: 'Data Model', path: '/data-model' }] });
    // a new document clears the manual column pick, the dependency card and the "show all" state
    effect(() => { this.doc(); this.picked.set(null); this.closeDep(); this.showAll.set(false); });
    effect(() => { this.module(); this.stop(); });
    // opening a document brings it into view
    afterRenderEffect(() => {
      if (!this.doc()) return;
      (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('.dm-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    // bring the chosen column (or the row we jumped to) into view inside its scrolling table
    afterRenderEffect(() => {
      this.active(); this.find(); this.tab();
      const root = this.host.nativeElement as HTMLElement;
      const cell = root.querySelector<HTMLElement>('tr.r-hit td') ?? root.querySelector<HTMLElement>('thead th.c-on');
      cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
  }

  // ── only what was filled ────────────────────────────────────────────
  protected readonly showEmpty = signal(new Set<string>());
  protected readonly filledHeader = computed(() => (this.doc()?.header ?? []).filter((h) => !EMPTY_VALUES.has(h.value)));
  protected readonly parts = computed(() => {
    const d = this.doc();
    if (!d) return [];
    const tabs = d.tabs ?? [];
    const sub = d.subtabs ?? DOCS.find((x) => x.subtabs && tabs.some((t) => t.doc === x.id))?.subtabs ?? [];
    return tabs.flatMap((t) => (t.doc === 'routing-processes' ? sub.map((s) => ({ label: `Routing · ${s.label}`, doc: s.doc })) : [t]));
  });
  protected hiddenCols(g: Grid): Col[] {
    return g.cols.filter((c) => c.type !== 'key' && c.type !== 'calc' && !c.dep && g.rows.every((r) => EMPTY_VALUES.has(r[c.key] ?? '')));
  }
  protected visibleCols(g: Grid): Col[] {
    if (this.showEmpty().has(g.id)) return g.cols;
    const hidden = new Set(this.hiddenCols(g).map((c) => c.key));
    return g.cols.filter((c) => !hidden.has(c.key));
  }
  protected toggleEmpty(g: Grid): void {
    this.showEmpty.update((s) => { const n = new Set(s); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; });
  }

  // ── colour / size dependency ────────────────────────────────────────
  protected readonly dep = signal<'color' | 'size' | null>(null);
  protected readonly depRow = signal<number>(-1);
  protected readonly depLine = signal<Row | null>(null);
  protected readonly depInfo = computed<Dependency | null>(() => {
    const k = this.dep(), row = this.depLine();
    return k && row ? dependencyFor(k, String(row['article']), String(row['name'] ?? '')) : null;
  });
  protected openDep(kind: 'color' | 'size', ri: number, row: Row): void {
    if (this.dep() === kind && this.depRow() === ri) return this.closeDep();
    this.dep.set(kind); this.depRow.set(ri); this.depLine.set(row);
  }
  protected closeDep(): void { this.dep.set(null); this.depRow.set(-1); this.depLine.set(null); }
  protected count(d: Dependency, what: 'onArticle' | 'mapped' | 'not-used'): number {
    return what === 'onArticle' ? d.rows.filter((r) => r.onArticle).length : d.rows.filter((r) => r.status === what).length;
  }

  protected docName(id: string) { return docById(id)?.name ?? id; }
  protected colLabel(docId: string, key: string) {
    for (const g of docById(docId)?.grids ?? []) { const c = g.cols.find((x) => x.key === key); if (c) return c.label; }
    return docById(docId)?.header.find((h) => h.label === key)?.label ?? key;
  }
  protected show(v: Cell | undefined): string {
    if (v === undefined || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : v;
  }

  // ── navigation ──────────────────────────────────────────────────────
  private nav(params: Record<string, string | null>) {
    this.router.navigate([], { queryParams: params, replaceUrl: false });
  }
  protected pickModule(id: string) {
    this.nav(id === this.module()?.id && !this.doc() ? { module: null, doc: null, tab: null, col: null, find: null, by: null } : { module: id, doc: null, tab: null, col: null, find: null, by: null });
  }
  protected pickDoc(id: string, tab: string | null = null) { this.nav({ module: moduleOfDoc(id)?.id ?? null, doc: id, tab, col: null, find: null, by: null }); }
  protected closeDoc() { this.nav({ doc: null, tab: null, col: null, find: null, by: null }); }
  protected setTab(t: TabId) { this.nav({ tab: t === 'overview' ? null : t, col: null, find: null, by: null }); }
  protected goCol(id: string, col: string) { this.nav({ module: moduleOfDoc(id)?.id ?? null, doc: id, tab: 'data', col, find: null, by: null }); }
  protected openCol(g: Grid, c: Col) {
    this.picked.set({ grid: g.id, col: c.key });
    this.nav({ tab: 'data', col: null, find: null, by: null });
  }
  protected follow(c: Col, v: Cell) {
    if (!c.from) return;
    this.nav({ module: moduleOfDoc(c.from.doc)?.id ?? null, doc: c.from.doc, tab: 'data', col: c.from.col, find: String(v), by: c.from.col });
  }

  protected pickCol(g: Grid, c: Col) {
    const cur = this.active();
    this.picked.set(cur && cur.grid === g.id && cur.col === c.key ? { grid: '', col: '' } : { grid: g.id, col: c.key });
  }
  protected isCol(g: Grid, c: Col) { const a = this.active(); return !!a && a.grid === g.id && a.col === c.key; }
  protected isSrc(g: Grid, c: Col) {
    const a = this.active();
    if (!a || a.grid !== g.id) return false;
    return !!g.cols.find((x) => x.key === a.col)?.uses?.includes(c.key);
  }
  protected isHitRow(row: Row) {
    const f = this.find(), b = this.by();
    return !!f && !!b && String(row[b]) === f;
  }
  protected colInfo(g: Grid) {
    const a = this.active();
    const d = this.doc();
    if (!a || a.grid !== g.id || !d) return null;
    const col = g.cols.find((c) => c.key === a.col);
    if (!col) return null;
    const calc = col.calc ? calcById(col.calc) : undefined;
    return {
      col,
      formula: col.formula ?? calc?.formula.replace(/^[^=]*=\s*/, ''),
      example: calc?.example,
      uses: (col.uses ?? []).map((u) => g.cols.find((c) => c.key === u)!).filter(Boolean),
      usedBy: consumers(d.id).filter((x) => x.col.from?.col === col.key),
    };
  }

  protected open(s: Shot) {
    this.zoom.set(s);
    this.lightbox()?.nativeElement.showModal();
  }
  protected close() {
    this.lightbox()?.nativeElement.close();
    this.zoom.set(null);
  }
}
