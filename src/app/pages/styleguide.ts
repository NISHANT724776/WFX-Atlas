// /styleguide — the design system rendered live with the app's own tokens and components. Internal review page
// (not in the navigation, not indexed). Every value shown is read from the running CSS, so this page cannot drift
// from the app. Groups are added here as they are built: 01 colour, 02 type, 03 scales, 04 icons and brand, 05 state components, 06 empty / loading / error and the homepage motif, 07 motion primitives.
import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, signal, viewChildren } from '@angular/core';
import { SeoService } from '../core/seo.service';
import { Icon, MODULE_ICON_NAMES } from '../shared/icon';
import { FormulaBadge, LIFECYCLE, Lifecycle, StateChip, StepMarker } from '../shared/states';
import { Status } from '../shared/status';
import { HeroMotif } from '../shared/hero-motif';
import { drawPath, replay, restartClass, sequence, tweenValue } from '../core/motion';
import type { IndentState } from '../shared/states';

interface Tok { name: string; label: string; against?: string; need?: number }
interface Group { title: string; note: string; tokens: Tok[] }

const SURF = '--wfx-surface';
const GROUPS: Group[] = [
  { title: 'Surfaces', note: 'Elevation on dark is surface + hairline; on light a soft shadow.', tokens: [
    { name: '--wfx-canvas', label: 'canvas' }, { name: '--wfx-surface', label: 'surface' }, { name: '--wfx-surface-2', label: 'surface-2 · raised' },
    { name: '--wfx-surface-3', label: 'surface-3 · pressed' }, { name: '--wfx-hairline', label: 'hairline' }, { name: '--wfx-hairline-str', label: 'hairline-str' }] },
  { title: 'Ink', note: 'Text needs 4.5:1 on surface.', tokens: [
    { name: '--wfx-ink', label: 'ink', against: SURF, need: 4.5 }, { name: '--wfx-ink-2', label: 'ink-2 · secondary', against: SURF, need: 4.5 }, { name: '--wfx-ink-3', label: 'ink-3 · labels', against: SURF, need: 4.5 }] },
  { title: 'Accent', note: 'Means "something changed or is live". One accent moment per viewport.', tokens: [
    { name: '--wfx-accent', label: 'accent', against: SURF, need: 4.5 }, { name: '--wfx-accent-ink', label: 'accent-ink · text on accent', against: '--wfx-accent', need: 4.5 },
    { name: '--wfx-accent-dim', label: 'accent-dim · at rest' }, { name: '--wfx-accent-wash', label: 'accent-wash' }] },
  { title: 'Lifecycle ramp', note: 'Warmer = closer to physical stock. State colours need 3:1 on surface.', tokens: [
    { name: '--wfx-state-0', label: 'Not ordered', against: SURF, need: 3 }, { name: '--wfx-state-1', label: 'PO created', against: SURF, need: 3 },
    { name: '--wfx-state-2', label: 'ASN done', against: SURF, need: 3 }, { name: '--wfx-state-3', label: 'GRN done', against: SURF, need: 3 }] },
  { title: 'Support', note: 'Sparingly; never competes with the accent.', tokens: [
    { name: '--wfx-ok', label: 'ok · confirmed', against: SURF, need: 4.5 }, { name: '--wfx-warn', label: 'warn · to confirm', against: SURF, need: 4.5 },
    { name: '--wfx-bad', label: 'bad · error, conflict', against: SURF, need: 4.5 }, { name: '--wfx-focus', label: 'focus ring', against: SURF, need: 3 }] },
];
const TYPE = [
  { cls: 'wfx-display', token: '--wfx-t-display', size: '38 → 72 · −0.045em', face: 'Geist 500', use: 'Homepage hero only', text: 'Every WFX transaction, <em>explained</em>' },
  { cls: 'wfx-h1', token: '--wfx-t-1', size: '30 → 48 · −0.035em', face: 'Geist 500', use: 'Page title', text: 'Buyer Block Booking' },
  { cls: 'wfx-answer', token: '--wfx-t-2', size: '24 → 28', face: 'Geist 500', use: 'The one-line answer of a Theory page', text: 'Booked fabric is reserved for a buyer before the order exists.' },
  { cls: 'wfx-h2', token: '--wfx-t-3', size: '22', face: 'Geist 500', use: 'Section heading', text: 'Material requirement' },
  { cls: 'wfx-lead', token: '--wfx-t-4', size: '18 → 20', face: 'Geist 400', use: 'Lead paragraph', text: 'The order needs 1,500 KG; 600 KG is booked, so 1,100 KG is still to buy.' },
  { cls: 'wfx-body', token: '--wfx-t-body', size: '16 / 26', face: 'Geist 400', use: 'Body', text: 'An Adhoc Indent raised from the booking carries the booked quantity until it is adjusted to the order.' },
  { cls: 'wfx-sm', token: '--wfx-t-sm', size: '14', face: 'Geist 400', use: 'Captions, table cells, meta', text: 'Updated after GRN · RMPO 1229' },
  { cls: 'wfx-eyebrow', token: '--wfx-t-xs', size: '13 — the floor', face: 'Geist 500, sentence case', use: 'Label above a section', text: 'Type' },
];
const SPACE = [['--wfx-space-0', '2', 'hairline offsets only'], ['--wfx-space-1', '4', ''], ['--wfx-space-2', '8', ''], ['--wfx-space-3', '12', ''], ['--wfx-space-4', '16', ''], ['--wfx-space-5', '24', 'gutter'], ['--wfx-space-6', '40', ''], ['--wfx-space-7', '64', ''], ['--wfx-space-8', '96', 'section rhythm']];
const RADII = [['--wfx-radius-sm', '8'], ['--wfx-radius', '12'], ['--wfx-radius-lg', '20'], ['--wfx-radius-pill', '999']];
const MOTION = [['--wfx-dur-micro', '150ms', 'hover in'], ['--wfx-dur-out', '120ms', 'hover out'], ['--wfx-dur-press', '90ms', 'button press'], ['--wfx-dur-element', '240ms', 'card, panel, dropdown'], ['--wfx-dur-rise', '700ms', 'heading lines rising on load, once'], ['--wfx-dur-fade', '520ms', 'lead and buttons after the heading'], ['--wfx-stagger', '60ms', 'between siblings'], ['--wfx-ease', 'cubic-bezier(.2,.8,.2,1)', 'hover and press'], ['--wfx-ease-enter', 'cubic-bezier(.22,1,.36,1)', 'entering']];

/** WCAG relative luminance contrast of two colours as the browser resolved them. */
function contrast(a: string, b: string): number | null {
  const rgb = (c: string) => { const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return null; if (m.length > 3 && Number(m[3]) < 1) return null; return m.slice(0, 3).map(Number); };
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return null;
  const L = (v: number[]) => { const [r, g, bl] = v.map((n) => { const s = n / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const l1 = L(x), l2 = L(y);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

@Component({
  selector: 'app-styleguide',
  imports: [Icon, Lifecycle, StateChip, StepMarker, FormulaBadge, Status, HeroMotif],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="sg-head">
      <p class="wfx-eyebrow">Design system · internal</p>
      <h1 class="wfx-display">The <em>instrument</em> panel, specified.</h1>
      <p class="wfx-lead">Tokens, type and scales rendered live from the app's own CSS, in both themes. If this page and a screen disagree, this page wins. Groups are added as they are built.</p>
    </header>

    <section class="sg-sec" aria-labelledby="sg-colour">
      <p class="wfx-eyebrow">01 · Colour</p>
      <h2 class="wfx-h1" id="sg-colour">Surfaces, ink, accent and state</h2>
      <p class="wfx-body">Measured contrast is computed in your browser from the resolved token values. ✓ meets the rule shown, ✗ fails it.</p>
      <div class="sg-themes">
        @for (t of themes; track t) {
          <div class="sg-theme" [attr.data-theme]="t" #themePanel>
            <p class="wfx-eyebrow">{{ t === 'light' ? 'Light · paper' : 'Dark · ink' }}</p>
            @for (g of groups; track g.title) {
              <h3 class="wfx-h2 sg-gt">{{ g.title }}</h3>
              <p class="wfx-sm">{{ g.note }}</p>
              <ul class="sg-swatches">
                @for (k of g.tokens; track k.name) {
                  <li class="sg-sw">
                    <span class="sg-chip" [style.background]="'var(' + k.name + ')'"></span>
                    <span class="sg-sw-text">
                      <span class="wfx-sm sg-sw-label">{{ k.label }}</span>
                      <code class="wfx-code">{{ k.name }}</code>
                      <span class="wfx-code">{{ value(t, k.name) }}</span>
                      @if (k.need) {
                        @let r = ratio(t, k);
                        <span class="wfx-num sg-ratio" [class.bad]="r !== null && r < k.need">{{ r === null ? '–' : r.toFixed(2) + ':1' }} {{ r === null ? '' : r >= k.need ? '✓' : '✗' }} <span class="wfx-sm">needs {{ k.need }}:1</span></span>
                      }
                    </span>
                  </li>
                }
              </ul>
            }
          </div>
        }
      </div>
    </section>

    <section class="sg-sec" aria-labelledby="sg-type">
      <p class="wfx-eyebrow">02 · Type</p>
      <h2 class="wfx-h1" id="sg-type">Three faces, three jobs</h2>
      <p class="wfx-body">Geist for everything you read: headings at weight 500 with tight tracking, body at 16/26. Geist Mono for every quantity, code and formula, always with tabular figures. Labels are sentence case at 13px; nothing is smaller.</p>
      <div class="sg-type">
        @for (t of type; track t.cls) {
          <div class="sg-type-row">
            <div class="sg-type-meta">
              <code class="wfx-code">.{{ t.cls }}</code>
              <span class="wfx-sm">{{ t.size }}px · {{ t.face }}</span>
              <span class="wfx-sm">{{ t.use }}</span>
            </div>
            <p [class]="t.cls" [innerHTML]="t.text"></p>
          </div>
        }
      </div>
      <h3 class="wfx-h2 sg-gt">Quantities</h3>
      <p class="wfx-body">Every quantity uses <code class="wfx-code">.wfx-num</code>. Tabular figures keep columns aligned and stop values jittering when they change.</p>
      <div class="sg-nums">
        <div><p class="wfx-eyebrow">Booked (BBB)</p><p class="wfx-num wfx-num--lg">600<span class="wfx-num--unit">KG</span></p></div>
        <div><p class="wfx-eyebrow">Order needs</p><p class="wfx-num wfx-num--lg">1,500<span class="wfx-num--unit">KG</span></p></div>
        <div><p class="wfx-eyebrow">Adjustment</p><p class="wfx-num wfx-num--lg">400<span class="wfx-num--unit">KG</span></p></div>
        <div><p class="wfx-eyebrow">Still to buy</p><p class="wfx-num wfx-num--lg">1,100<span class="wfx-num--unit">KG</span></p></div>
      </div>
      <p class="wfx-sm">Codes and references: <span class="wfx-code">PPJ179.1</span> · <span class="wfx-code">NIS-58</span> · <span class="wfx-code">RMPO 1229</span></p>
    </section>

    <section class="sg-sec" aria-labelledby="sg-scales">
      <p class="wfx-eyebrow">03 · Scales</p>
      <h2 class="wfx-h1" id="sg-scales">Spacing, radius, elevation, motion</h2>
      <h3 class="wfx-h2 sg-gt">Spacing · 4px base</h3>
      <p class="wfx-body">Section rhythm is 96. Nothing between 64 and 96.</p>
      <ul class="sg-space">
        @for (s of space; track s[0]) {
          <li><span class="sg-bar" [style.width]="'var(' + s[0] + ')'"></span><span class="wfx-num">{{ s[1] }}</span><code class="wfx-code">{{ s[0] }}</code><span class="wfx-sm">{{ s[2] }}</span></li>
        }
      </ul>
      <h3 class="wfx-h2 sg-gt">Radius</h3>
      <ul class="sg-radii">
        @for (r of radii; track r[0]) { <li><span class="sg-rad" [style.border-radius]="'var(' + r[0] + ')'"></span><code class="wfx-code">{{ r[0] }}</code><span class="wfx-num">{{ r[1] }}</span></li> }
      </ul>
      <h3 class="wfx-h2 sg-gt">Elevation</h3>
      <div class="sg-elev">
        @for (t of themes; track t) {
          <div [attr.data-theme]="t" class="sg-elev-bg">
            <div class="sg-card" style="box-shadow: var(--wfx-elev-1)"><span class="wfx-sm">{{ t }} · elev-1</span></div>
            <div class="sg-card" style="box-shadow: var(--wfx-elev-2)"><span class="wfx-sm">{{ t }} · elev-2</span></div>
          </div>
        }
      </div>
      <h3 class="wfx-h2 sg-gt">Motion tokens</h3>
      <p class="wfx-body">The primitives that use them, each with a replay button, arrive with the motion group.</p>
      <table class="sg-table">
        <thead><tr><th scope="col">Token</th><th scope="col">Value</th><th scope="col">Use</th></tr></thead>
        <tbody>@for (m of motion; track m[0]) { <tr><td><code class="wfx-code">{{ m[0] }}</code></td><td class="wfx-num">{{ m[1] }}</td><td class="wfx-sm">{{ m[2] }}</td></tr> }</tbody>
      </table>
    </section>
    <section class="sg-sec" aria-labelledby="sg-icons">
      <p class="wfx-eyebrow">04 · Icons and brand</p>
      <h2 class="wfx-h1" id="sg-icons">Module set and wordmark</h2>
      <p class="wfx-body">One family, Lucide (ISC): 24px grid, 1.75px stroke (2px at 16), round cap and join, <code class="wfx-code">currentColor</code>. Ink at rest; the accent only marks the module that is open. Shown at 32, 24 and 16.</p>
      <ul class="sg-icons">
        @for (i of icons; track i.name) {
          <li>
            <span class="sg-icon-row"><app-icon [name]="i.name" [size]="32" /><app-icon [name]="i.name" [size]="24" /><app-icon [name]="i.name" [size]="16" /></span>
            <span class="wfx-sm sg-icon-label">{{ i.label }}</span>
            <code class="wfx-code">{{ i.name }}</code>
          </li>
        }
      </ul>
      <h3 class="wfx-h2 sg-gt">In a tile: at rest and open</h3>
      <div class="pick-row sg-tiles">
        <button type="button" class="pick-mod"><span class="pick-ic"><app-icon name="mod-setup" [size]="28" /></span><strong>At rest</strong></button>
        <button type="button" class="pick-mod on" aria-pressed="true"><span class="pick-ic"><app-icon name="mod-setup" [size]="28" /></span><strong>Open</strong></button>
      </div>
      <h3 class="wfx-h2 sg-gt">Wordmark and favicon</h3>
      <div class="sg-elev">
        @for (t of themes; track t) {
          <div [attr.data-theme]="t" class="sg-elev-bg sg-brand">
            <span class="brand">
              <svg class="brand-mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><rect width="32" height="32" rx="7.5" /><path d="M6.5 9.5 11 22.5 16 12.5 21 22.5 25.5 9.5" /></svg>
              <span class="brand-name"><span class="brand-wfx">WFX</span> <em>Atlas</em></span>
            </span>
            <img src="/favicon.svg" width="32" height="32" alt="Favicon" />
            <img src="/favicon.svg" width="16" height="16" alt="Favicon at 16px" />
          </div>
        }
      </div>
    </section>
    <section class="sg-sec" aria-labelledby="sg-states">
      <p class="wfx-eyebrow">05 · State components</p>
      <h2 class="wfx-h1" id="sg-states">Lifecycle, actors and proof</h2>
      <p class="wfx-body">Three small components that carry meaning, not decoration. Each is one reusable component; the same chip is used in the workflow chain, the scenario cards and the data tables.</p>

      <h3 class="wfx-h2 sg-gt">Lifecycle chain · the Adhoc Indent in each of its four states</h3>
      <p class="wfx-body">Warmer means closer to physical stock. The current state is filled, passed states are solid, states ahead are dashed and quiet.</p>
      <div class="sg-themes">
        @for (t of themes; track t) {
          <div class="sg-theme sg-stack" [attr.data-theme]="t">
            <p class="wfx-eyebrow">{{ t }}</p>
            @for (l of lifecycle; track l.id) {
              <div class="sg-lc-row"><wfx-lifecycle [state]="l.id" /><span class="wfx-sm">{{ l.meaning }}</span></div>
            }
          </div>
        }
      </div>
      <h3 class="wfx-h2 sg-gt">Chip on its own · as in a table cell</h3>
      <div class="sg-row">@for (l of lifecycle; track l.id) { <wfx-state-chip [state]="l.id" /> }</div>

      <h3 class="wfx-h2 sg-gt">USER and SYSTEM steps</h3>
      <p class="wfx-body">Readable without the label: a solid disc is a person acting, a dashed ring is WFX acting by itself. Only a SYSTEM step may shimmer while it runs.</p>
      <div class="sg-themes">
        @for (t of themes; track t) {
          <div class="sg-theme" [attr.data-theme]="t">
            <ul class="sg-steps">
              <li><wfx-step-marker actor="user" [size]="24" /><span><strong>Create Buyer Block Booking</strong><br /><span class="wfx-sm">Merchandiser enters the booking</span></span></li>
              <li><wfx-step-marker actor="system" [size]="24" /><span><strong>Auto-populate materials</strong><br /><span class="wfx-sm">WFX copies the BOM lines</span></span></li>
              <li><wfx-step-marker actor="system" [size]="24" [processing]="true" /><span><strong>MRP runs on confirmation</strong><br /><span class="wfx-sm">Running now (shimmer, SYSTEM only)</span></span></li>
            </ul>
            <div class="sg-row"><wfx-step-marker actor="user" [showLabel]="true" /><wfx-step-marker actor="system" [showLabel]="true" /><wfx-step-marker actor="user" [size]="16" /><wfx-step-marker actor="system" [size]="16" /></div>
          </div>
        }
      </div>

      <h3 class="wfx-h2 sg-gt">Formula badges</h3>
      <p class="wfx-body">Verified reproduces the value WFX showed on screen. To confirm could not be proved yet and carries its open question: hover it, or reach it with Tab.</p>
      <div class="sg-themes">
        @for (t of themes; track t) {
          <div class="sg-theme sg-stack" [attr.data-theme]="t">
            <div class="sg-formula"><wfx-formula-badge status="verified" /><p class="wfx-num">Requirement = Qty per colour/size × Consumption</p><p class="wfx-sm">600 KG · matches the WFX screen.</p></div>
            <div class="sg-formula"><wfx-formula-badge status="assumed" question="Which exchange-rate table does WFX use (BOM date, company rate, or OC rate)?" /><p class="wfx-num sg-unproven">Value (CS Curr) = Value × exchange rate</p><p class="wfx-sm">Not proved by the sample data: the rate was 1.</p></div>
          </div>
        }
      </div>
    </section>
    <section class="sg-sec" aria-labelledby="sg-empty">
      <p class="wfx-eyebrow">06 · States and motif</p>
      <h2 class="wfx-h1" id="sg-empty">Empty, loading, error</h2>
      <p class="wfx-body">One component for every state that has no content yet. Loading is announced politely, an error is an alert and offers a way out. The compact form sits inside a card or a list.</p>
      <div class="sg-themes">
        @for (t of themes; track t) {
          <div class="sg-theme sg-stack" [attr.data-theme]="t">
            <wfx-status kind="loading" title="Getting the data ready" detail="Loading the WFX tables into your browser." />
            <wfx-status kind="empty" title="No cases recorded yet" detail="Cases appear here once the owner documents one." />
            <wfx-status kind="error" title="The data could not be loaded" detail="The knowledge server did not answer."><button type="button" class="btn small">Try again</button></wfx-status>
            <div class="sg-formula">
              <wfx-status kind="loading" title="Loading the records" [compact]="true" />
              <wfx-status kind="empty" title="No gaps recorded yet" [compact]="true" />
              <wfx-status kind="error" title="Could not save the draft" [compact]="true" />
            </div>
          </div>
        }
      </div>
      <h3 class="wfx-h2 sg-gt">Homepage motif</h3>
      <p class="wfx-body">Three journeys as lanes on the 24px grid, steps as nodes, documented links as dashed connectors. The single accent is the live link: a booking linked to the sales order.</p>
      <div class="sg-themes">
        @for (t of themes; track t) { <div class="sg-theme" [attr.data-theme]="t"><wfx-hero-motif /></div> }
      </div>
    </section>
    <section class="sg-sec" aria-labelledby="sg-motion">
      <p class="wfx-eyebrow">07 · Motion</p>
      <h2 class="wfx-h1" id="sg-motion">Primitives</h2>
      <p class="wfx-body">Every animation in the app is built from these. Each one says in a sentence what it teaches; if it could not, it would not exist. Numbers tween, layout snaps. With reduced motion every one becomes a 120 ms cross-fade to the same end state.</p>
      <div class="sg-motion">
        <article class="sg-m">
          <header><code class="wfx-code">.wfx-enter</code><button type="button" class="btn small" (click)="again(enterBox)">Replay</button></header>
          <div class="sg-m-stage"><span class="sg-m-box wfx-enter" #enterBox></span></div>
          <p class="wfx-sm">Teaches: this content just arrived. 240 ms, rises 8 px, enter easing.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">.wfx-exit</code><button type="button" class="btn small" (click)="exit(exitBox)">Replay</button></header>
          <div class="sg-m-stage"><span class="sg-m-box" #exitBox></span></div>
          <p class="wfx-sm">Teaches: this is going away. 120 ms, faster than it came, exit easing.</p>
        </article>
        <article class="sg-m sg-m-wide">
          <header><code class="wfx-code">.wfx-stagger</code><button type="button" class="btn small" (click)="again(staggerRow)">Replay</button></header>
          <div class="sg-m-stage"><div class="sg-m-row wfx-stagger" #staggerRow>@for (i of twelve; track i) { <span class="sg-m-dot"></span> }</div></div>
          <p class="wfx-sm">Teaches: these belong to one list, in this order. 40 ms apart, the first 8 cascade, the rest arrive as one block.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">tweenValue()</code><button type="button" class="btn small" (click)="tween(num)">Change</button></header>
          <div class="sg-m-stage"><span class="wfx-num wfx-num--lg" #num data-value="600">600</span><span class="wfx-num--unit">KG</span></div>
          <p class="wfx-sm">Teaches: the quantity changed and by how much. A spring (180 / 24), tabular figures so nothing jumps; one accent pulse.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">drawPath()</code><button type="button" class="btn small" (click)="draw(line)">Replay</button></header>
          <div class="sg-m-stage"><svg viewBox="0 0 200 48" class="sg-m-svg"><path #line class="sg-m-path" d="M8 40 C 60 40, 70 8, 120 8 S 180 24, 192 24" /></svg></div>
          <p class="wfx-sm">Teaches: this path is the route. Drawn once from its real length, 400 ms.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">.wfx-flow-line</code><span class="wfx-sm">hover the line</span></header>
          <div class="sg-m-stage"><svg viewBox="0 0 200 48" class="sg-m-svg sg-m-flow"><path class="wfx-flow-line" d="M8 24 H192" /><path d="M184 18 192 24 184 30" class="sg-m-head" /></svg></div>
          <p class="wfx-sm">Teaches: data moves in this direction. Runs once on hover, never forever.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">.wfx-shimmer</code></header>
          <div class="sg-m-stage sg-m-steps"><wfx-step-marker actor="system" [size]="24" [processing]="true" [showLabel]="true" /><wfx-step-marker actor="user" [size]="24" [showLabel]="true" /></div>
          <p class="wfx-sm">Teaches: WFX is working on this step right now. SYSTEM steps only; a USER step never shimmers.</p>
        </article>
        <article class="sg-m">
          <header><code class="wfx-code">.wfx-table-enter</code><button type="button" class="btn small" (click)="again(table)">Replay</button></header>
          <div class="sg-m-stage"><table class="sg-table wfx-table-enter" #table><tbody><tr><td>Booked</td><td class="wfx-num">600</td></tr><tr><td>Needs</td><td class="wfx-num">1,500</td></tr></tbody></table></div>
          <p class="wfx-sm">Teaches: here is a table to compare. Fade only; numbers in tables never animate.</p>
        </article>
      </div>

      <h3 class="wfx-h2 sg-gt">State-change choreography · cause, then effect, 80 ms apart</h3>
      <p class="wfx-body">A specimen of the rule, not the simulator: the status moves first, then the adjustment, then what is still to buy. The lag is what teaches the causal chain; updating everything at once teaches nothing.</p>
      <div class="sg-chain">
        <div class="sg-row" role="group" aria-label="Adhoc Indent status">
          @for (l of lifecycle; track l.id) { <button type="button" class="btn small" [attr.aria-pressed]="chainState() === l.id" [class.on]="chainState() === l.id" (click)="choreo(l.id, adj, buy)">{{ l.label }}</button> }
        </div>
        <wfx-lifecycle [state]="chainState()" />
        <div class="sg-nums">
          <div><p class="wfx-eyebrow">Booked (BBB)</p><p class="wfx-num wfx-num--lg">600<span class="wfx-num--unit">KG</span></p></div>
          <div><p class="wfx-eyebrow">Order needs</p><p class="wfx-num wfx-num--lg">1,500<span class="wfx-num--unit">KG</span></p></div>
          <div><p class="wfx-eyebrow">Adjustment · effect 1</p><p class="wfx-num wfx-num--lg"><span #adj data-value="0">0</span><span class="wfx-num--unit">KG</span></p></div>
          <div><p class="wfx-eyebrow">Still to buy · effect 2</p><p class="wfx-num wfx-num--lg"><span #buy data-value="1500">1,500</span><span class="wfx-num--unit">KG</span></p></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; padding-block: var(--wfx-space-7) var(--wfx-space-8); }
    .sg-head { max-width: var(--wfx-measure); }
    .sg-head .wfx-display { margin: var(--wfx-space-4) 0 var(--wfx-space-5); }
    .sg-sec { margin-top: var(--wfx-space-8); padding-top: var(--wfx-space-7); border-top: var(--wfx-border); }
    .sg-sec > .wfx-h1 { margin: var(--wfx-space-3) 0 var(--wfx-space-4); }
    .sg-gt { margin: var(--wfx-space-6) 0 var(--wfx-space-2); }
    .sg-themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: var(--wfx-space-5); margin-top: var(--wfx-space-5); }
    .sg-theme { background: var(--wfx-canvas); color: var(--wfx-ink); border: var(--wfx-border); border-radius: var(--wfx-radius-lg); padding: var(--wfx-space-5); }
    .sg-swatches { list-style: none; padding: 0; margin: var(--wfx-space-3) 0 0; display: grid; gap: var(--wfx-space-2); }
    .sg-sw { display: flex; gap: var(--wfx-space-3); align-items: center; padding: var(--wfx-space-2); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); }
    .sg-chip { flex: none; width: 40px; height: 40px; border-radius: var(--wfx-radius-sm); border: var(--wfx-border-str); }
    .sg-sw-text { display: flex; flex-wrap: wrap; gap: var(--wfx-space-1) var(--wfx-space-3); align-items: baseline; }
    .sg-sw-label { color: var(--wfx-ink); min-width: 11ch; }
    .sg-ratio { font-size: var(--wfx-t-sm); color: var(--wfx-ok); }
    .sg-ratio.bad { color: var(--wfx-bad); }
    .sg-type { display: grid; gap: var(--wfx-space-5); margin-top: var(--wfx-space-5); }
    .sg-type-row { display: grid; grid-template-columns: minmax(0, 220px) minmax(0, 1fr); gap: var(--wfx-space-5); align-items: baseline; padding-bottom: var(--wfx-space-5); border-bottom: var(--wfx-border); }
    .sg-type-row p { margin: 0; }
    .sg-type-meta { display: grid; gap: var(--wfx-space-1); }
    @media (max-width: 640px) { .sg-type-row { grid-template-columns: 1fr; gap: var(--wfx-space-2); } }
    .sg-nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--wfx-space-4); margin: var(--wfx-space-4) 0; }
    .sg-nums > div { background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); padding: var(--wfx-space-4); }
    .sg-nums p { margin: 0 0 var(--wfx-space-2); }
    .sg-space, .sg-radii { list-style: none; padding: 0; display: grid; gap: var(--wfx-space-2); }
    .sg-space li { display: grid; grid-template-columns: 100px 40px 140px 1fr; gap: var(--wfx-space-3); align-items: center; }
    .sg-bar { display: block; height: var(--wfx-space-3); background: var(--wfx-ink-3); border-radius: var(--wfx-space-0); }
    .sg-radii { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--wfx-space-4); }
    .sg-radii li { display: grid; gap: var(--wfx-space-2); }
    .sg-rad { width: 64px; height: 64px; border: var(--wfx-border-str); background: var(--wfx-surface-2); }
    .sg-elev { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: var(--wfx-space-5); }
    .sg-elev-bg { display: flex; gap: var(--wfx-space-4); padding: var(--wfx-space-5); background: var(--wfx-canvas); border: var(--wfx-border); border-radius: var(--wfx-radius-lg); }
    .sg-card { flex: 1; padding: var(--wfx-space-5) var(--wfx-space-4); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); color: var(--wfx-ink); }
    .sg-icons { list-style: none; padding: 0; margin: var(--wfx-space-5) 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); gap: var(--wfx-space-4); }
    .sg-icons li { display: grid; gap: var(--wfx-space-2); padding: var(--wfx-space-4); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); }
    .sg-icon-row { display: flex; align-items: flex-end; gap: var(--wfx-space-4); color: var(--wfx-ink); }
    .sg-icon-label { color: var(--wfx-ink); }
    .sg-tiles { margin-top: var(--wfx-space-3); }
    .sg-brand { align-items: center; color: var(--wfx-ink); }
    .sg-brand .brand { margin-right: auto; }
    .sg-stack { display: grid; gap: var(--wfx-space-4); align-content: start; }
    .sg-lc-row { display: grid; gap: var(--wfx-space-1); }
    .sg-row { display: flex; flex-wrap: wrap; gap: var(--wfx-space-3); align-items: center; margin-top: var(--wfx-space-3); }
    .sg-steps { list-style: none; padding: 0; margin: 0 0 var(--wfx-space-4); display: grid; gap: var(--wfx-space-3); }
    .sg-steps li { display: flex; gap: var(--wfx-space-3); align-items: flex-start; }
    .sg-formula { display: grid; gap: var(--wfx-space-2); justify-items: start; padding: var(--wfx-space-4); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); }
    .sg-formula p { margin: 0; }
    .sg-unproven { text-decoration: underline dashed var(--wfx-hairline-str); text-underline-offset: 5px; }
    .sg-motion { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: var(--wfx-space-4); margin-top: var(--wfx-space-5); }
    .sg-m { display: grid; gap: var(--wfx-space-3); align-content: start; padding: var(--wfx-space-4); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius); }
    .sg-m header { display: flex; justify-content: space-between; align-items: center; gap: var(--wfx-space-2); }
    .sg-m p { margin: 0; }
    .sg-m-wide { grid-column: span 2; }
    @media (max-width: 640px) { .sg-m-wide { grid-column: auto; } }
    .sg-m-stage { display: flex; align-items: center; gap: var(--wfx-space-2); min-height: 72px; padding: var(--wfx-space-3); background: var(--wfx-canvas); border-radius: var(--wfx-radius-sm); }
    .sg-m-box { display: block; width: 48px; height: 48px; border-radius: var(--wfx-radius); background: var(--wfx-surface-3); border: var(--wfx-border-str); }
    .sg-m-row { display: flex; flex-wrap: wrap; gap: var(--wfx-space-2); }
    .sg-m-dot { width: var(--wfx-space-5); height: var(--wfx-space-5); border-radius: var(--wfx-radius-sm); background: var(--wfx-surface-3); }
    .sg-m-svg { width: 100%; height: 48px; overflow: visible; }
    .sg-m-svg path { fill: none; stroke: var(--wfx-ink-2); stroke-width: 1.5; stroke-linecap: round; }
    .sg-m-path { stroke: var(--wfx-accent) !important; }
    .sg-m-flow:hover .wfx-flow-line { animation: wfx-flow var(--wfx-dur-section) var(--wfx-ease-standard) both; }
    .sg-m-steps { gap: var(--wfx-space-5); }
    .sg-chain { display: grid; gap: var(--wfx-space-4); margin-top: var(--wfx-space-4); padding: var(--wfx-space-5); background: var(--wfx-surface); border: var(--wfx-border); border-radius: var(--wfx-radius-lg); }
    .sg-chain .sg-row { margin: 0; }
    .sg-chain .btn.on { background: var(--wfx-ink); color: var(--wfx-canvas); border-color: var(--wfx-ink); }
    .sg-table { width: 100%; border-collapse: collapse; margin-top: var(--wfx-space-3); }
    .sg-table th, .sg-table td { text-align: left; padding: var(--wfx-space-2) var(--wfx-space-3); border-bottom: var(--wfx-border); }
    .sg-table th { font-size: var(--wfx-t-xs); color: var(--wfx-ink-3); font-weight: 500; }
  `],
})
export default class StyleguidePage {
  protected readonly themes = ['light', 'dark'] as const;
  protected readonly groups = GROUPS;
  protected readonly type = TYPE;
  protected readonly space = SPACE;
  protected readonly radii = RADII;
  protected readonly motion = MOTION;
  protected readonly lifecycle = LIFECYCLE;
  protected readonly twelve = Array.from({ length: 12 }, (_, i) => i);
  protected readonly chainState = signal<IndentState>('none');
  private flip = false;
  protected again(el: Element) { replay(el); }
  protected exit(el: Element) { el.classList.remove('wfx-enter'); restartClass(el, 'wfx-exit'); setTimeout(() => { el.classList.remove('wfx-exit'); restartClass(el, 'wfx-enter'); }, 700); }
  protected tween(el: HTMLElement) { this.flip = !this.flip; tweenValue(el, this.flip ? 1500 : 600); }
  protected draw(path: Element) { drawPath(path as SVGPathElement); }
  /** Cause (the status chip), then effect 1 (adjustment), then effect 2 (still to buy), 80 ms apart. Specimen values from the pack. */
  protected choreo(state: IndentState, adj: HTMLElement, buy: HTMLElement) {
    const adjusted = state === 'none' ? 0 : 400;
    sequence([() => this.chainState.set(state), () => tweenValue(adj, adjusted), () => tweenValue(buy, 1500 - adjusted)]);
  }
  protected readonly icons = MODULE_ICON_NAMES.map((name) => ({ name, label: ({ 'mod-setup': 'Setup rules', 'mod-style': 'Style & BOM', 'mod-booking': 'Booking & sourcing', 'mod-sales': 'Sales Order', 'mod-planning': 'Planning', 'mod-production': 'Production', 'mod-inventory': 'Inventory, QC & WMS', 'mod-tna': 'TNA', 'mod-masters': 'Masters', 'mod-definitions': 'Definitions & formulas' } as Record<string, string>)[name] ?? name }));
  private readonly panels = viewChildren<ElementRef<HTMLElement>>('themePanel');
  /** Resolved token values per theme, read from the rendered panels (empty on the server). */
  private readonly resolved = signal<Record<string, Record<string, string>>>({});

  constructor() {
    inject(SeoService).set({ title: 'Styleguide', description: 'The WFX Atlas design system, rendered live.', path: '/styleguide', noindex: true, crumbs: [{ label: 'Styleguide', path: '/styleguide' }] });
    afterNextRender(() => {
      const out: Record<string, Record<string, string>> = {};
      for (const p of this.panels()) {
        const el = p.nativeElement; const theme = el.dataset['theme']!;
        const cs = getComputedStyle(el);
        const probe = el.ownerDocument.createElement('span'); el.appendChild(probe);
        out[theme] = {};
        for (const g of GROUPS) for (const k of g.tokens) {
          out[theme][k.name] = cs.getPropertyValue(k.name).trim();
          probe.style.color = `var(${k.name})`; out[theme][`rgb:${k.name}`] = getComputedStyle(probe).color;
        }
        probe.style.color = `var(${SURF})`; out[theme][`rgb:${SURF}`] = getComputedStyle(probe).color;
        probe.remove();
      }
      this.resolved.set(out);
    });
  }
  protected value(theme: string, name: string) { return this.resolved()[theme]?.[name] ?? ''; }
  protected ratio(theme: string, k: Tok): number | null {
    const r = this.resolved()[theme];
    return r ? contrast(r[`rgb:${k.name}`] ?? '', r[`rgb:${k.against}`] ?? '') : null;
  }
}
