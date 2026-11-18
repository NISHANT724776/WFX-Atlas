import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { SectionSwitch } from '../shared/section-switch';
import { FORMAT_LABELS, layoutDiagram, orderedSteps } from './diagram-layout';
import type { GEdge, GGraph, GNode, Format, NodeType, Placed } from './diagram-layout';
import { KbGate, KbTabs } from './shared';

type Overlay = '' | 'validations' | 'rules' | 'io' | 'dependencies';
interface RuleRef { id: string; title: string; status: string; category: string }
interface Ref { id: string; title: string; kind: string; status: string }
interface WNode extends GNode { rules?: RuleRef[]; dependencies?: string[]; images?: { src: string; caption: string }[]; sources?: string[] }
interface Graph extends GGraph {
  id: string; description: string; nodes: WNode[]; preconditions: string; postconditions: string; exceptions: string; relatedTransactions: string; source: string; status: string; version: number; basisNote: string;
  module: string; references: Ref[]; submodule: string; assumptions: string[]; missing: string[]; dependencies: string[]; relatedDocuments: Ref[];
}
interface Problem { level: string; message: string; nodes?: string[] }
interface Path { name: string; steps: string[] }
interface Selection { recommended: Format; reasons: string[]; alternatives: { format: Format; reason: string }[]; metrics: Record<string, number | boolean>; requested: Format | null }
interface Doc { graph: Graph; detail: 'overview' | 'detailed'; overlay: Overlay; collapsed: string[]; compare: { with: string; changes: Record<string, string[]> } | null; notes: string[]; lifecycle: Graph | null; selection: Selection | null }
interface DraftMeta {
  id: string; title: string; request: string; state: 'ready' | 'failed'; error: string | null; conversationId: string | null; version: number; workflowId: string; entryId: string | null;
  createdAt: string; updatedAt: string; approvalStatus: string; saved: boolean; savedVersion: number | null;
}
interface DraftView { draft: DraftMeta; doc: Doc | null; problems: Problem[]; paths: Path[]; mermaid: string; versions: { version: number; reason: string; createdAt: string }[] }
interface View { graph: Graph; problems: Problem[]; paths: Path[]; mermaid: string; selection?: Selection; versions?: { version: number; status: string; file: string }[] }
interface ChatLine { who: 'you' | 'wfx'; text: string; ok: boolean }

const OVERLAYS: { id: Overlay; label: string }[] = [{ id: '', label: 'No extra detail' }, { id: 'validations', label: 'Validations' }, { id: 'rules', label: 'Business rules' }, { id: 'io', label: 'Inputs / outputs' }, { id: 'dependencies', label: 'Dependencies' }];
const ALL_FORMATS = Object.keys(FORMAT_LABELS).filter((f) => f !== 'sections') as Format[];

@Component({
  selector: 'app-workflow-designer',
  imports: [KbGate, KbTabs, FormsModule, RouterLink, SectionSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section-switch group="workflows" />
    <h1 class="kb-h1">Workflow designer</h1>
    <kb-gate next="/workflow-designer">
      <kb-tabs />
      @if (draft()?.conversationId; as conv) { <p class="small"><a routerLink="/assistant" [queryParams]="{ c: conv }">← Back to the chat this workflow came from</a></p> }

      @if (loadError(); as err) {
        <section class="kb-panel kb-pad" role="alert">
          <p class="kb-bad">{{ err.message }}</p>
          <p class="small muted">{{ err.draftId ? 'Nothing was lost: the draft ' + err.draftId + ' is still stored, so you can try again.' : 'If you came from the chat, your request and its answer are still there.' }}</p>
          <div class="kb-row"><button class="btn primary small" type="button" (click)="reload()">Try again</button>@if (conversationBack()) { <a class="btn small" routerLink="/assistant" [queryParams]="{ c: conversationBack() }">Back to the chat</a> }</div>
        </section>
      }
      @if (draft(); as d) {
        @if (d.state === 'failed') {
          <section class="kb-panel kb-pad" role="alert">
            <h3>The workflow could not be generated</h3>
            <p class="small">Your request was kept: <em>“{{ d.request }}”</em></p>
            <p class="kb-bad small">{{ d.error }}</p>
            <button class="btn primary small" type="button" (click)="retryGeneration()" [disabled]="busy()">Retry the generation</button>
            @if (msg()) { <p class="small" [class.kb-bad]="bad()">{{ msg() }}</p> }
          </section>
        }
      }

      <div class="kb-filter">
        <select [ngModel]="loadId" (ngModelChange)="open($event)" name="load" aria-label="Open a stored workflow or procedure">
          <option value="">Open a stored workflow or procedure…</option>
          <optgroup label="Workflows">@for (w of list().workflows; track w.id + w.version) { <option [value]="w.id">{{ w.title }} ({{ w.status }})</option> }</optgroup>
          <optgroup label="Procedures with steps">@for (w of list().procedures; track w.id) { <option [value]="w.id">{{ w.title }}</option> }</optgroup>
        </select>
        <button class="btn small" type="button" (click)="showGen.set(!showGen())">New from text or Mermaid</button>
        <button class="btn small" type="button" (click)="blank()">Blank</button>
      </div>
      @if (showGen()) {
        <section class="kb-panel kb-pad">
          <p class="small muted">Write the process as steps (one per line; "If &lt;condition&gt;, &lt;step&gt;, else &lt;step&gt;" makes a decision), or paste a Mermaid flowchart. Every step you write is marked <em>proposed</em> until a source documents it.</p>
          <input class="kb-wide" [(ngModel)]="genName" name="gn" placeholder="Workflow name" />
          <textarea rows="6" class="kb-wide" [(ngModel)]="genText" name="gt" placeholder="1. Merchandiser raises the indent&#10;2. If stock is available, do in-house adjustment, else create RMPO&#10;3. Store makes the GRN"></textarea>
          <button class="btn primary small" type="button" (click)="generate()" [disabled]="!genText.trim()">Build workflow</button>
        </section>
      }

      <section class="kb-panel kb-pad wd-chat" aria-label="Ask or change the workflow in plain language">
        @if (chatLog().length) {
          <ul class="wd-chatlog" aria-live="polite">@for (l of chatLog(); track $index) { <li [attr.data-who]="l.who" [class.kb-bad]="l.who === 'wfx' && !l.ok">{{ l.who === 'you' ? 'You' : 'WFX' }}: {{ l.text }}</li> }</ul>
        }
        <form class="kb-ask" (ngSubmit)="sendChat()">
          <textarea name="chat" rows="1" [(ngModel)]="chatText" (keydown.enter)="chatEnter($event)" aria-label="Your message"
            [placeholder]="draft()?.state === 'ready' ? 'Change this workflow: e.g. add the BOM creation step after article setup' : 'Ask for a workflow: e.g. show the complete MRP workflow'"></textarea>
          <button class="btn primary" type="submit" [disabled]="busy() || !chatText.trim()">{{ busy() ? 'Working…' : 'Send' }}</button>
        </form>
      </section>

      @if (g(); as gr) {
        <section class="kb-panel kb-pad">
          <details class="wd-info small"><summary>Details · {{ formatLabel(gr.format) }} · {{ draft()?.approvalStatus ?? gr.status }}</summary>
          @if (draft(); as d) {
            <dl class="wd-meta">
              <div><dt>Workflow ID</dt><dd>{{ d.workflowId }}</dd></div>
              <div><dt>Module</dt><dd>{{ gr.module || '–' }}{{ gr.submodule ? ' › ' + gr.submodule : '' }}</dd></div>
              <div><dt>Transactions</dt><dd>{{ gr.relatedTransactions || '–' }}</dd></div>
              <div><dt>Version</dt><dd>{{ d.version }}{{ d.saved ? ' · library v' + d.savedVersion : '' }}</dd></div>
              <div><dt>Created</dt><dd>{{ d.createdAt.slice(0, 10) }}</dd></div>
              <div><dt>Last updated</dt><dd>{{ d.updatedAt.slice(0, 16).replace('T', ' ') }}</dd></div>
              <div><dt>Diagram type</dt><dd>{{ formatLabel(gr.format) }}</dd></div>
              <div><dt>Approval status</dt><dd><span class="kb-badge" [attr.data-s]="d.approvalStatus">{{ d.approvalStatus }}</span> @if (!d.saved) { <span class="muted small">(generated draft, not in the library)</span> }</dd></div>
            </dl>
          }
          @if (selection(); as sel) {
            <div class="wd-why small">
              <strong>{{ sel.requested ? 'Chosen from your request' : 'Recommended view' }}: {{ formatLabel(sel.recommended) }}.</strong> {{ sel.reasons.join(' ') }}
              <span class="muted"> {{ metricLine(sel) }}</span>
              <div class="kb-row wd-views" role="group" aria-label="Other views of the same workflow">
                <span class="muted">Other views of the same workflow:</span>
                @for (a of sel.alternatives; track a.format) { <button type="button" class="chip-btn" [title]="a.reason" (click)="setFormat(a.format)">{{ formatLabel(a.format) }}</button> }
              </div>
            </div>
          }
          <p class="muted small">Sources, assumptions and open points ({{ gr.references.length + gr.relatedDocuments.length }} sources · {{ gr.missing.length }} open)</p><div class="small">
            <ul class="kb-list">@for (r of gr.references; track r.id) { <li><span class="kb-src-status" [attr.data-ok]="r.status === 'Active' || r.status === 'Approved'">{{ r.status }}</span> <a [routerLink]="r.kind === 'document' ? '/library' : '/rulebook'" [queryParams]="r.kind === 'document' ? { doc: r.id } : { id: r.id }">{{ r.id }}</a> · {{ r.title }} <span class="muted">({{ r.kind }})</span></li> }</ul>
            @if (gr.relatedDocuments.length) { <p class="muted">Related documents:</p>
              <ul class="kb-list">@for (r of gr.relatedDocuments; track r.id) { <li>@if (r.kind === 'image') { <a [href]="docOriginal(r.id)" target="_blank" rel="noopener"><img class="wd-thumb" [src]="docOriginal(r.id)" [alt]="r.title" loading="lazy" /></a> } <a routerLink="/library" [queryParams]="{ doc: r.id }">{{ r.id }}</a> · {{ r.title }} <span class="muted">({{ r.kind === 'image' ? "owner's image, shown as supplied" : r.status }})</span></li> }</ul> }
            @if (gr.missing.length) { <p class="kb-warn">Missing or conflicting information:</p><ul>@for (m of gr.missing; track $index) { <li>{{ m }}</li> }</ul> }
            @if (gr.assumptions.length) { <p class="muted">Assumptions and exclusions stated by the source:</p><ul>@for (m of gr.assumptions; track $index) { <li>{{ m }}</li> }</ul> }
            @if (draft(); as d) { <p class="muted">Request: “{{ d.request }}”</p> }
          </div>
          </details>
          <div class="kb-row">
            <label>Name <input [(ngModel)]="gr.name" name="nm" (ngModelChange)="touch()" /></label>
            <label>View as <select [ngModel]="gr.format" (ngModelChange)="setFormat($event)" name="fmt">@for (f of formatChoices(); track f) { <option [value]="f">{{ formatLabel(f) }}</option> }</select></label>
            <label>Detail <select [ngModel]="detail()" (ngModelChange)="setDetail($event)" name="det"><option value="detailed">Detailed</option><option value="overview">Overview</option></select></label>
            <label>Show on steps <select [ngModel]="overlay()" (ngModelChange)="setOverlay($event)" name="ovl">@for (o of overlays; track o.id) { <option [value]="o.id">{{ o.label }}</option> }</select></label>
            @if (gr.format === 'flowchart') { <label>Direction <select [(ngModel)]="gr.direction" name="dir" (ngModelChange)="relayout()"><option value="TD">Top to bottom</option><option value="LR">Left to right</option></select></label> }
          </div>
          @if (gr.basisNote) { <p class="small muted">{{ gr.basisNote }}</p> }
          @if (doc()?.compare; as c) {
            <div class="kb-banner small"><strong>Compared with “{{ c.with }}”:</strong>
              <ul class="kb-list">@for (k of cmpKeys; track k) { @if (c.changes[k]?.length) { <li><strong>{{ k }}</strong>: {{ c.changes[k].slice(0, 8).join('; ') }}{{ c.changes[k].length > 8 ? ' …' : '' }}</li> } }</ul></div>
          }
          @if (sections().length > 1) {
            <div class="kb-row wd-sections" role="group" aria-label="Sections">
              <span class="small muted">Sections (click to {{ collapsed().length ? 'expand or ' : '' }}collapse):</span>
              @for (s of sections(); track s) { <button type="button" class="chip-btn" [class.on]="collapsed().includes(s)" [attr.aria-pressed]="collapsed().includes(s)" (click)="toggleSection(s)">{{ s }}</button> }
              <button type="button" class="linklike small" (click)="setDetail('detailed')">Expand all</button>
              <button type="button" class="linklike small" (click)="setDetail('overview')">Collapse all</button>
            </div>
          }

          @if (gr.format === 'guide') {
            <ol class="wd-guide">
              @for (n of guide(); track n.id; let i = $index) {
                <li class="wd-card" [class.sel]="sel() === n.id" (click)="sel.set(n.id)" (keydown.enter)="sel.set(n.id)" tabindex="0" [attr.data-basis]="n.basis">
                  <span class="wd-step-no">{{ i + 1 }}</span>
                  <h4>{{ n.label }}</h4>
                  <p class="small muted">{{ n.type === 'decision' ? 'Decision' : (n.lane || n.role || 'Step') }} · {{ n.basis }}</p>
                  @if (n.description) { <p class="small">{{ n.description }}</p> }
                  @if (n.images?.length) { <img [src]="n.images![0].src" [alt]="n.images![0].caption" loading="lazy" /> }
                  <p class="small muted">{{ n.inputs?.length ?? 0 }} inputs · {{ n.validations?.length ?? 0 }} validations · {{ n.rules?.length ?? 0 }} rules</p>
                </li>
              }
            </ol>
          } @else {
            <div class="wd-stage" #stage>
              <div class="kb-row wd-tools" role="toolbar" aria-label="Designer tools">
                <button class="btn small" type="button" (click)="zoomBy(1.2)" aria-label="Zoom in">＋</button>
                <button class="btn small" type="button" (click)="zoomBy(1 / 1.2)" aria-label="Zoom out">－</button>
                <button class="btn small" type="button" (click)="fit()">Fit</button>
                <button class="btn small" type="button" [class.on]="fullscreen()" (click)="toggleFullscreen()">{{ fullscreen() ? 'Exit full screen' : 'Full screen' }}</button>
                <input class="wd-search" type="search" [ngModel]="query()" (ngModelChange)="query.set($event)" (keydown.enter)="findNext()" name="q" placeholder="Search this workflow" aria-label="Search this workflow" />
                @if (query().trim()) { <span class="small muted">{{ matches() }} match{{ matches() === 1 ? '' : 'es' }}</span> }
                <details class="wd-edit"><summary class="btn small">Edit ▾</summary><div class="wd-edit-menu">
                <button class="btn small" type="button" (click)="zoom.set(1)">100 %</button>
                <button class="btn small" type="button" [class.on]="showMap()" (click)="showMap.set(!showMap())">Mini-map</button>
                @if (gr.format === 'flowchart' || gr.format === 'sections') { <button class="btn small" type="button" (click)="relayout()">Arrange</button> }
                <button class="btn small" type="button" (click)="add('activity')">+ Step</button>
                <button class="btn small" type="button" (click)="add('decision')">+ Decision</button>
                <button class="btn small" type="button" (click)="add('exception')">+ Exception</button>
                <button class="btn small" type="button" [class.on]="connectFrom()" (click)="startConnect()" [disabled]="!sel()">{{ connectFrom() ? 'Click the target…' : 'Connect from selected' }}</button>
                <button class="btn small" type="button" (click)="remove()" [disabled]="!sel() && selEdge() === null">Delete selected</button>
                </div></details>
              </div>
              <div class="wd-canvas" #box (wheel)="wheel($event)" (scroll)="onScroll()" [class.pan]="panning()">
                <svg id="wd-svg" [attr.width]="view().w * zoom()" [attr.height]="view().h * zoom()" [attr.viewBox]="'0 0 ' + view().w + ' ' + view().h" role="img" [attr.aria-label]="formatLabel(gr.format) + ' of ' + gr.name"
                     xmlns="http://www.w3.org/2000/svg" (pointerdown)="panStart($event)" (pointermove)="move($event)" (pointerup)="drop()" (pointerleave)="drop()">
                  <defs>
                    <marker id="wd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="wd-arrowhead" /></marker>
                  </defs>
                  @for (l of view().lanes; track l.name; let i = $index) {
                    <g class="wd-lane" [class.alt]="i % 2 === 1">
                      @if (view().laneVertical) {
                        <rect [attr.x]="l.x" y="0" [attr.width]="l.w" [attr.height]="view().h" />
                        <rect [attr.x]="l.x" y="0" [attr.width]="l.w" height="34" class="wd-lane-head" />
                        <text [attr.x]="l.x + l.w / 2" y="22" text-anchor="middle" class="wd-lane-name">{{ short(l.name, 26) }}</text>
                      } @else {
                        <rect x="0" [attr.y]="l.y" [attr.width]="view().w" [attr.height]="l.h" />
                        <rect x="0" [attr.y]="l.y" [attr.width]="view().laneHead" [attr.height]="l.h" class="wd-lane-head" />
                        <text x="10" [attr.y]="l.y + l.h / 2 + 4" class="wd-lane-name">{{ short(l.name, 16) }}</text>
                      }
                    </g>
                  }
                  @for (ax of view().axes; track ax.y) { <line class="wd-axis" [attr.x1]="ax.x1" [attr.x2]="ax.x2" [attr.y1]="ax.y" [attr.y2]="ax.y" marker-end="url(#wd-arrow)" /> }
                  @for (e of view().edges; track $index; let i = $index) {
                    <g class="wd-edge" [attr.data-kind]="e.kind" [class.sel]="selEdge() === e.src && e.src >= 0" [class.long]="e.long" [class.focus]="touches(e.from, e.to)" [class.dim]="dimEdge(e.from, e.to) || (!!sel() && !touches(e.from, e.to))" (click)="pickEdge(e.src)">
                      <path [attr.d]="e.d" [attr.marker-end]="e.from === e.to ? null : 'url(#wd-arrow)'" />
                      <path [attr.d]="e.d" class="wd-hit" />
                      @if (e.label) { <text [attr.x]="e.lx" [attr.y]="e.ly" class="wd-elabel" text-anchor="middle">{{ short(e.label, 26) }}</text> }
                    </g>
                  }
                  @for (n of view().nodes; track n.id) {
                    <g class="wd-node" [attr.data-type]="n.type" [attr.data-shape]="n.shape" [attr.data-basis]="n.basis" [class.sel]="sel() === n.id" [class.bad]="badNodes().has(n.id)" [class.hit]="n.match" [class.dim]="n.dim"
                       [attr.transform]="'translate(' + n.x + ',' + n.y + ')'" tabindex="0" role="button" [attr.aria-label]="n.label + ' (' + n.type + ', ' + n.basis + ')'"
                       (pointerdown)="grab($event, n)" (click)="pick(n)" (dblclick)="expand(n)" (keydown.enter)="pick(n)" (keydown.delete)="remove()">
                      @switch (n.shape) {
                        @case ('decision') { <polygon [attr.points]="diamond(n)" /> }
                        @case ('gateway-x') { <polygon [attr.points]="diamond(n)" /><path d="M20 20L36 36M36 20L20 36" class="wd-glyph" /> }
                        @case ('gateway-plus') { <polygon [attr.points]="diamond(n)" /><path d="M28 17V39M17 28H39" class="wd-glyph" /> }
                        @case ('event-start') { <circle [attr.cx]="n.w / 2" [attr.cy]="n.h / 2" r="18" /> }
                        @case ('event-end') { <circle [attr.cx]="n.w / 2" [attr.cy]="n.h / 2" r="17" class="wd-thick" /> }
                        @case ('dot') { <circle [attr.cx]="n.w / 2" [attr.cy]="n.h / 2" r="7" class="wd-solid" /> }
                        @case ('section') { <rect x="6" y="6" [attr.width]="n.w" [attr.height]="n.h" rx="6" class="wd-stack" /><rect [attr.width]="n.w" [attr.height]="n.h" rx="6" /> }
                        @case ('store') { <path [attr.d]="'M0 0H' + n.w + 'M0 ' + n.h + 'H' + n.w" class="wd-storeline" /><rect [attr.width]="n.w" [attr.height]="n.h" class="wd-storebg" /> }
                        @case ('root') { <rect [attr.width]="n.w" [attr.height]="n.h" rx="32" class="wd-rootbox" /> }
                        @case ('milestone') { <rect [attr.width]="n.w" [attr.height]="n.h" rx="8" /> }
                        @case ('pill') { <rect [attr.width]="n.w" [attr.height]="n.h" rx="22" /> }
                        @case ('state') { <rect [attr.width]="n.w" [attr.height]="n.h" rx="26" /> }
                        @case ('process') { <rect [attr.width]="n.w" [attr.height]="n.h" rx="28" /> }
                        @default { <rect [attr.width]="n.w" [attr.height]="n.h" [attr.rx]="n.type === 'start' || n.type === 'end' ? 28 : 10" /> }
                      }
                      @if (n.shape === 'event-start' || n.shape === 'event-end' || n.shape === 'gateway-x' || n.shape === 'gateway-plus') {
                        @for (ln of n.lines; track $index; let i = $index) { <text [attr.x]="n.w / 2" [attr.y]="n.h + 13 + i * 12" text-anchor="middle" class="wd-text">{{ ln }}</text> }
                      } @else if (n.shape !== 'dot') {
                        @for (ln of n.lines; track $index; let i = $index) { <text [attr.x]="n.w / 2" [attr.y]="n.h / 2 + 4 + (i - (n.lines.length - 1) / 2) * 13 - (n.sub && detail() === 'detailed' && n.lines.length < 3 ? 5 : 0)" text-anchor="middle" class="wd-text">{{ ln }}</text> }
                        @if (n.sub && detail() === 'detailed' && n.lines.length < 3 && n.shape !== 'section') { <text [attr.x]="n.w / 2" [attr.y]="n.h - 8" text-anchor="middle" class="wd-role">{{ short(n.sub, 30) }}</text> }
                      }
                      @if (n.badge) { <g class="wd-badge" [class.on]="n.badgeOn" [attr.transform]="'translate(' + (n.w - 6) + ',-8)'"><rect x="-34" y="0" width="40" height="16" rx="8" /><text x="-14" y="12" text-anchor="middle">{{ n.badge }}</text></g> }
                    </g>
                  }
                </svg>
              </div>
              @if (showMap() && view().nodes.length > 6) {
                <svg class="wd-minimap" [attr.viewBox]="'0 0 ' + view().w + ' ' + view().h" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Mini-map" (click)="mapClick($event)">
                  @for (n of view().nodes; track n.id) { <rect [attr.x]="n.x" [attr.y]="n.y" [attr.width]="n.w" [attr.height]="n.h" [class.hit]="n.match" rx="6" /> }
                  <rect class="wd-viewport" [attr.x]="viewport().x" [attr.y]="viewport().y" [attr.width]="viewport().w" [attr.height]="viewport().h" />
                </svg>
              }
            </div>
            <p class="small muted">Drag the background to pan, drag steps to move them (flowchart), double-click a collapsed section to expand it, Ctrl + scroll to zoom. Solid border = documented by a source, dashed = proposed, dotted = inferred.</p>
          }

          <div class="kb-grid2">
            <div>
              @if (selVirtual(); as sv) {
                <h3>{{ sv.section }} <span class="muted small">(collapsed section)</span></h3>
                <ol class="small">@for (m of sv.members; track m.id) { <li>{{ m.label }}</li> }</ol>
                <button class="btn small" type="button" (click)="toggleSection(sv.section)">Expand this section</button>
              } @else if (selNode(); as n) {
                <h3>{{ n.label }}</h3>
                <p class="small muted">{{ n.type }} · {{ n.basis }}{{ n.role ? ' · ' + n.role : '' }}{{ n.transaction ? ' · transaction ' + n.transaction : '' }}{{ n.section ? ' · ' + n.section : '' }}{{ n.lane && n.lane !== n.section ? ' · ' + n.lane : '' }}</p>
                @if (n.description) { <p class="small">{{ n.description }}</p> }
                @if (n.note) { <p class="small muted">{{ n.note }}</p> }
                <div class="wd-detail">
                  <h4>Inputs</h4>@if (n.inputs?.length) { <ul class="small">@for (x of n.inputs!; track $index) { <li>{{ x }}</li> }</ul> } @else { <p class="small muted">None documented.</p> }
                  <h4>Outputs</h4>@if (n.outputs?.length) { <ul class="small">@for (x of n.outputs!; track $index) { <li>{{ x }}</li> }</ul> } @else { <p class="small muted">None documented.</p> }
                  <h4>Business rules</h4>@if (n.rules?.length) { <ul class="small">@for (x of n.rules!; track x.id) { <li><a routerLink="/rulebook" [queryParams]="{ id: x.id }">{{ x.title }}</a> <span class="muted">{{ x.id }} · {{ x.status }}</span></li> }</ul> } @else { <p class="small muted">None documented.</p> }
                  <h4>Transaction dependencies</h4>@if (n.dependencies?.length) { <ul class="small">@for (x of n.dependencies!; track $index) { <li>{{ x }}</li> }</ul> } @else { <p class="small muted">None documented.</p> }
                  <h4>Validations, controls and messages</h4>@if (n.validations?.length) { <ul class="small">@for (x of n.validations!; track $index) { <li>{{ x }}</li> }</ul> } @else { <p class="small muted">No validation is documented for this step.</p> }
                  <h4>Reference screens</h4>@if (n.images?.length) { <div class="wd-shots">@for (i of n.images!; track i.src) { <figure><a [href]="i.src" target="_blank" rel="noopener"><img [src]="i.src" [alt]="i.caption" loading="lazy" /></a><figcaption class="small muted">{{ i.caption }}</figcaption></figure> }</div> } @else { <p class="small muted">No screenshot is stored for this step.</p> }
                  <h4>Source documentation</h4>@if (n.sources?.length) { <ul class="small">@for (x of n.sources!; track $index) { <li>{{ x }}</li> }</ul> } @else { <p class="small muted">Not linked to a document or transaction.</p> }
                </div>
                <h4>Edit this step</h4>
                <form class="kb-form" (ngSubmit)="touch()">
                  <label>Text <input name="l" [(ngModel)]="n.label" (ngModelChange)="edited(n)" /></label>
                  <label>Kind <select name="t" [(ngModel)]="n.type" (ngModelChange)="touch()">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select></label>
                  <label>Who (role) <input name="r" [(ngModel)]="n.role" (ngModelChange)="touch()" /></label>
                  <label>Transaction <input name="x" [(ngModel)]="n.transaction" (ngModelChange)="touch()" /></label>
                  <label>Note <textarea name="no" rows="2" [(ngModel)]="n.note" (ngModelChange)="touch()"></textarea></label>
                  <p class="small">Basis: <strong>{{ n.basis }}</strong>{{ n.basis === 'documented' ? ' (changing the text makes it proposed)' : '' }}</p>
                </form>
              } @else if (selEdge() !== null && gr.edges[selEdge()!]) {
                <h3>Connection</h3>
                <p class="small muted">{{ gr.edges[selEdge()!].kind || 'sequence' }}</p>
                <label class="kb-form">Condition / label <input [(ngModel)]="gr.edges[selEdge()!].label" name="el" (ngModelChange)="touch()" /></label>
              } @else { <p class="muted small">Click a step to see its description, inputs and outputs, rules, dependencies, validations, screens and sources.</p> }
              <h3>Conditions around the workflow</h3>
              <div class="kb-form">
                <label>Preconditions <textarea rows="2" name="pre" [(ngModel)]="gr.preconditions" (ngModelChange)="touch()"></textarea></label>
                <label>Postconditions <textarea rows="2" name="post" [(ngModel)]="gr.postconditions" (ngModelChange)="touch()"></textarea></label>
                <label>Exceptions and rules not tied to a step <textarea rows="3" name="exc" [(ngModel)]="gr.exceptions" (ngModelChange)="touch()"></textarea></label>
                <label>Related transactions <input name="rel" [(ngModel)]="gr.relatedTransactions" (ngModelChange)="touch()" /></label>
              </div>
            </div>
            <div>
              <h3>Checks</h3>
              @if (problems().length) { <ul class="kb-list small">@for (p of problems(); track $index) { <li [class.kb-bad]="p.level === 'error'" [class.kb-warn]="p.level === 'warning'">{{ p.message }}</li> }</ul> }
              @else { <p class="small">No structural problems: one start, one end, every step reachable, decisions have branches.</p> }
              <h3>Test paths <span class="muted small">({{ paths().length }})</span></h3>
              <ol class="small">@for (p of paths(); track $index) { <li><strong>{{ p.name }}</strong>: {{ p.steps.join(' → ') }}</li> }</ol>
              <div class="kb-row">
                @if (draft(); as d) {
                  <button class="btn small" type="button" (click)="saveVersion()" [disabled]="busy()">Save version</button>
                  <button class="btn small" type="button" (click)="undo()" [disabled]="busy() || d.version < 2">Undo last change</button>
                  <button class="btn small" type="button" (click)="retryGeneration()" [disabled]="busy()" title="Build it again from the original request (kept as a new version)">Regenerate</button>
                  @if (kb.can('editor')) { <button class="btn primary small" type="button" (click)="saveToLibrary()" [disabled]="busy()">Save to the library as Draft</button> }
                } @else {
                  @if (kb.can('editor')) { <button class="btn primary small" type="button" (click)="save()">Save as draft</button> }
                }
                <button class="btn small" type="button" (click)="copyMermaid()">{{ copied() ? 'Copied' : 'Copy Mermaid' }}</button>
                <button class="btn small" type="button" (click)="exportJson()">JSON</button>
                <button class="btn small" type="button" (click)="exportSvg()">SVG</button>
                <button class="btn small" type="button" (click)="exportPng()">PNG</button>
                <button class="btn small" type="button" (click)="exportPdf()">PDF</button>
              </div>
              @if (draft(); as d) {
                @if (d.saved) {
                  <div class="kb-row small">
                    <span>Library entry <a routerLink="/rulebook" [queryParams]="{ id: d.entryId }">{{ d.entryId }}</a> is <strong>{{ d.approvalStatus }}</strong>.</span>
                    @if (kb.can('editor') && d.approvalStatus === 'Draft') { <button class="btn small" type="button" (click)="moveTo('Under Review')">Send for review</button> }
                    @if (kb.can('editor') && ['Draft', 'Under Review', 'Approved', 'Active'].includes(d.approvalStatus)) { <button class="btn small" type="button" (click)="moveTo('Archived')">Archive</button> }
                    <a [routerLink]="['/rulebook']" [queryParams]="{ id: d.entryId }">Approve in the Rulebook</a>
                  </div>
                }
              } @else if (gr.id) { <a class="small" [routerLink]="['/rulebook']" [queryParams]="{ id: gr.id }">Open in the Rulebook (approve, versions)</a> }
              @if (msg()) { <p class="small" [class.kb-bad]="bad()">{{ msg() }}</p> }
              @if (draft(); as d) {
                @if (dversions().length > 1) {
                  <h3>Previous versions</h3>
                  <ul class="kb-list small">@for (v of dversions(); track v.version) { <li>v{{ v.version }} · {{ v.createdAt.slice(0, 16).replace('T', ' ') }} · {{ v.reason }}
                    @if (v.version !== d.version) { <button type="button" class="linklike small" (click)="previewVersion(v.version)">Open</button> <button type="button" class="linklike small" (click)="compareDraft(v.version)">Compare with current</button> }</li> }</ul>
                  @if (previewing()) { <p class="small kb-warn">Showing version {{ previewing() }} — “Save version” makes it the current one; reload to discard.</p> }
                  @if (cmp(); as c) { <ul class="kb-list small">@for (k of cmpKeys; track k) { @if (c[k].length) { <li><strong>{{ k }}</strong>: {{ c[k].join('; ') }}</li> } }</ul> }
                }
              } @else if ((versions().length) > 1) {
                <h3>Compare versions</h3>
                <div class="kb-row">
                  <select [(ngModel)]="va" name="va">@for (v of versions(); track v.version + v.file) { <option [ngValue]="v.version">v{{ v.version }} ({{ v.status }})</option> }</select>
                  <select [(ngModel)]="vb" name="vb">@for (v of versions(); track v.version + v.file) { <option [ngValue]="v.version">v{{ v.version }} ({{ v.status }})</option> }</select>
                  <button class="btn small" type="button" (click)="compare()">Compare</button>
                </div>
                @if (cmp(); as c) { <ul class="kb-list small">@for (k of cmpKeys; track k) { @if (c[k].length) { <li><strong>{{ k }}</strong>: {{ c[k].join('; ') }}</li> } }</ul> }
              }
            </div>
          </div>
        </section>
      }
    </kb-gate>
  `,
})
export default class WorkflowDesignerPage {
  protected readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly types: NodeType[] = ['activity', 'decision', 'parallel', 'exception', 'state', 'start', 'end'];
  protected readonly overlays = OVERLAYS;
  protected readonly list = signal<{ workflows: { id: string; title: string; status: string; version: number }[]; procedures: { id: string; title: string }[] }>({ workflows: [], procedures: [] });
  protected readonly g = signal<Graph | null>(null);
  protected readonly rev = signal(0);
  protected readonly problems = signal<Problem[]>([]);
  protected readonly paths = signal<Path[]>([]);
  protected readonly versions = signal<NonNullable<View['versions']>>([]);
  protected readonly dversions = signal<DraftView['versions']>([]);
  protected readonly mermaid = signal('');
  protected readonly draft = signal<DraftMeta | null>(null);
  protected readonly doc = signal<Doc | null>(null);
  private readonly storedSelection = signal<Selection | null>(null);
  /** Why this picture: from the draft, or computed for a stored workflow. */
  protected readonly selection = computed(() => this.doc()?.selection ?? this.storedSelection());
  protected readonly detail = signal<'overview' | 'detailed'>('detailed');
  protected readonly overlay = signal<Overlay>('');
  protected readonly collapsed = signal<string[]>([]);
  protected readonly query = signal('');
  protected readonly loadError = signal<{ message: string; draftId: string | null } | null>(null);
  protected readonly sel = signal<string | null>(null);
  protected readonly selEdge = signal<number | null>(null);
  protected readonly connectFrom = signal<string | null>(null);
  protected readonly zoom = signal(1);
  protected readonly showGen = signal(false);
  protected readonly showMap = signal(true);
  protected readonly fullscreen = signal(false);
  protected readonly panning = signal(false);
  protected readonly scrollPos = signal({ x: 0, y: 0, w: 800, h: 500 });
  protected readonly busy = signal(false);
  protected readonly previewing = signal<number | null>(null);
  protected readonly msg = signal(''); protected readonly bad = signal(false); protected readonly copied = signal(false);
  protected readonly cmp = signal<Record<string, string[]> | null>(null);
  protected readonly chatLog = signal<ChatLine[]>([]);
  protected readonly cmpKeys = ['nodesAdded', 'nodesRemoved', 'nodesChanged', 'edgesAdded', 'edgesRemoved', 'conditionsChanged'];
  protected loadId = ''; protected genName = ''; protected genText = ''; protected chatText = ''; protected va = 1; protected vb = 1;
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');
  private dragging: { id: string; dx: number; dy: number; svg: SVGSVGElement } | null = null;
  private pan: { x: number; y: number; sl: number; st: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastLoaded = '';
  private started = false;

  protected readonly selNode = computed(() => { this.rev(); return this.g()?.nodes.find((n) => n.id === this.sel()) ?? this.doc()?.lifecycle?.nodes.find((n) => n.id === this.sel()) ?? null; });
  protected readonly selVirtual = computed(() => {
    const id = this.sel();
    if (!id?.startsWith('sec:')) return null;
    const name = id.slice(4);
    return { section: name, members: (this.g()?.nodes ?? []).filter((n) => n.section === name) };
  });
  protected readonly badNodes = computed(() => new Set(this.problems().filter((p) => p.level === 'error').flatMap((p) => p.nodes ?? [])));
  protected readonly sections = computed(() => { this.rev(); return [...new Set((this.g()?.nodes ?? []).filter((n) => n.type !== 'start' && n.type !== 'end').map((n) => n.section).filter((s): s is string => !!s))]; });
  protected readonly conversationBack = computed(() => this.draft()?.conversationId ?? this.route.snapshot.queryParamMap.get('c'));
  protected readonly guide = computed(() => { this.rev(); const g = this.g(); return g ? orderedSteps(g) as WNode[] : []; });
  protected readonly formatChoices = computed(() => ALL_FORMATS.filter((f) => f !== 'lifecycle' || !!this.doc()?.lifecycle));
  /** What the canvas draws: the same nodes and edges laid out for the chosen picture. */
  protected readonly view = computed(() => {
    this.rev();
    const g = this.g();
    if (!g) return layoutDiagram({ name: '', direction: 'TD', nodes: [], edges: [], format: 'flowchart' }, 'flowchart', { collapsed: new Set(), detailed: true, overlay: '', query: '', lifecycle: null });
    return layoutDiagram(g, g.format, { collapsed: new Set(this.collapsed()), detailed: this.detail() === 'detailed', overlay: this.overlay(), query: this.query(), lifecycle: this.doc()?.lifecycle ?? null });
  });
  protected readonly matches = computed(() => this.view().nodes.filter((n) => n.match).length);
  protected readonly viewport = computed(() => { const s = this.scrollPos(), z = this.zoom(); return { x: s.x / z, y: s.y / z, w: s.w / z, h: s.h / z }; });

  constructor() {
    inject(SeoService).set({ title: 'Workflow designer', description: 'Design, check and version WFX workflows from documented steps.', path: '/workflow-designer', noindex: true, crumbs: [{ label: 'Workflow designer', path: '/workflow-designer' }] });
    effect(() => {
      if (!this.kb.user() || this.started) return;
      this.started = true;
      void this.kb.get<{ workflows: { id: string; title: string; status: string; version: number }[]; procedures: { id: string; title: string }[] }>('/workflows').then((l) => this.list.set(l)).catch(() => undefined);
      this.route.paramMap.subscribe(() => void this.follow());
      this.route.queryParamMap.subscribe(() => void this.follow());
    });
  }
  @HostListener('document:fullscreenchange') protected onFs() { this.fullscreen.set(!!document.fullscreenElement); queueMicrotask(() => this.onScroll()); }

  // ── loading ───────────────────────────────────────────────────────────────
  /** The workflow named by the address: /workflow-designer/<draft id> (survives a reload), or ?id=<stored workflow>. */
  private async follow() {
    const param = this.route.snapshot.paramMap.get('id'), q = this.route.snapshot.queryParamMap;
    const draftId = param?.startsWith('WFD-') ? param : q.get('draft'), stored = param && !param.startsWith('WFD-') ? param : q.get('id');
    const key = `${draftId ?? ''}|${stored ?? ''}`;
    if (key === this.lastLoaded || key === '|') return;
    this.lastLoaded = key;
    if (draftId) await this.loadDraft(draftId); else if (stored) await this.open(stored, false);
  }
  protected async reload() { this.lastLoaded = ''; await this.follow(); }
  private async loadDraft(id: string) {
    this.loadError.set(null); this.msg.set('');
    try { this.setDraft(await this.kb.get<DraftView>(`/workflow-drafts/${encodeURIComponent(id)}`)); }
    catch (e) { this.loadError.set({ message: `The workflow could not be opened: ${(e as Error).message}`, draftId: (e as { status?: number }).status === 404 ? null : id }); }
  }
  private setDraft(v: DraftView) {
    this.draft.set(v.draft); this.dversions.set(v.versions); this.previewing.set(null); this.cmp.set(null);
    if (!v.doc) { this.g.set(null); this.doc.set(null); this.sel.set(null); return; }
    this.doc.set(v.doc); this.detail.set(v.doc.detail); this.overlay.set(v.doc.overlay); this.collapsed.set(v.doc.collapsed);
    this.g.set(v.doc.graph); this.problems.set(v.problems); this.paths.set(v.paths); this.mermaid.set(v.mermaid); this.versions.set([]);
    this.sel.set(null); this.selEdge.set(null); this.rev.update((x) => x + 1);
    queueMicrotask(() => this.fit());
  }
  private set(v: View) {
    this.draft.set(null); this.doc.set(null); this.collapsed.set([]); this.overlay.set(''); this.detail.set('detailed'); this.storedSelection.set(v.selection ?? null);
    this.g.set(v.graph); this.problems.set(v.problems); this.paths.set(v.paths); this.mermaid.set(v.mermaid);
    if (v.versions) { this.versions.set(v.versions); this.va = v.versions[v.versions.length - 1]?.version ?? 1; this.vb = v.versions[0]?.version ?? 1; }
    this.sel.set(null); this.selEdge.set(null); this.cmp.set(null); this.rev.update((x) => x + 1);
    queueMicrotask(() => this.fit());
  }
  protected async open(id: string, navigate = true) {
    if (!id) return; this.loadId = id; this.msg.set(''); this.loadError.set(null);
    try { this.set(await this.kb.get<View>(`/workflows/${encodeURIComponent(id)}`)); if (navigate) { this.lastLoaded = `|${id}`; void this.router.navigate(['/workflow-designer'], { queryParams: { id }, replaceUrl: true }); } }
    catch (e) { this.loadError.set({ message: `The workflow could not be opened: ${(e as Error).message}`, draftId: null }); }
  }
  protected async generate() { this.set(await this.kb.post<View>('/workflows/generate', { text: this.genText, name: this.genName || 'New workflow' })); this.versions.set([]); this.showGen.set(false); }
  protected blank() { this.set({ graph: { id: '', name: 'New workflow', description: '', direction: 'TD', nodes: [{ id: 'start', type: 'start', label: 'Start', role: '', transaction: '', basis: 'inferred', note: '', x: 400, y: 40 }, { id: 'finish', type: 'end', label: 'End', role: '', transaction: '', basis: 'inferred', note: '', x: 400, y: 260 }], edges: [], preconditions: '', postconditions: '', exceptions: '', relatedTransactions: '', source: '', status: 'Draft', version: 0, basisNote: '', module: '', format: 'flowchart', references: [], submodule: '', assumptions: [], missing: [], dependencies: [], relatedDocuments: [] }, problems: [], paths: [], mermaid: '' }); this.versions.set([]); this.touch(); }

  // ── chat box ──────────────────────────────────────────────────────────────
  protected chatEnter(e: Event) { const k = e as KeyboardEvent; if (!k.shiftKey) { k.preventDefault(); void this.sendChat(); } }
  protected async sendChat() {
    const text = this.chatText.trim();
    if (!text || this.busy()) return;
    this.busy.set(true);
    const d = this.draft();
    try {
      if (d?.state === 'ready') {
        const r = await this.kb.post<DraftView & { reply: string; ok: boolean; newDraft: boolean; draftId: string }>(`/workflow-drafts/${d.id}/chat`, { message: text });
        this.chatLog.update((l) => [...l, { who: 'you', text, ok: true }, { who: 'wfx', text: r.reply, ok: r.ok }]);
        this.chatText = '';
        if (r.newDraft) await this.goDraft(r.draftId); else this.setDraft(r);
      } else {
        const r = await this.kb.post<{ draftId: string | null; answer: { sections: { text?: string }[]; title: string }; conversationId: string }>('/workflow-drafts', { request: text, conversationId: d?.conversationId ?? undefined });
        this.chatText = '';
        if (r.draftId) { this.chatLog.update((l) => [...l, { who: 'you', text, ok: true }, { who: 'wfx', text: 'Built it; opening it here.', ok: true }]); await this.goDraft(r.draftId); }
        else this.chatLog.update((l) => [...l, { who: 'you', text, ok: true }, { who: 'wfx', text: r.answer.sections[0]?.text ?? r.answer.title, ok: false }]);
      }
    } catch (e) { this.chatLog.update((l) => [...l, { who: 'wfx', text: `${(e as Error).message} Your message is kept in the box; send it again to retry.`, ok: false }]); }
    finally { this.busy.set(false); }
  }
  private async goDraft(id: string) { this.lastLoaded = ''; await this.router.navigate(['/workflow-designer', id]); }

  // ── view settings ─────────────────────────────────────────────────────────
  protected formatLabel(f: Format) { return FORMAT_LABELS[f] ?? f; }
  protected metricLine(s: Selection) { const m = s.metrics as Record<string, number>; return `(${m['activities']} steps, ${m['decisions']} decisions, ${Math.max(m['roles'], m['lanes'])} roles/lanes, ${m['transactions']} transactions)`; }
  protected setFormat(f: Format) { const g = this.g(); if (!g) return; g.format = f; this.sel.set(null); this.rev.update((x) => x + 1); this.touch(); queueMicrotask(() => this.fit()); }
  protected setDetail(d: 'overview' | 'detailed') { this.detail.set(d); this.collapsed.set(d === 'overview' ? this.sections() : []); this.touch(); queueMicrotask(() => this.fit()); }
  protected setOverlay(o: Overlay) { this.overlay.set(o); this.touch(); }
  protected toggleSection(s: string) { this.collapsed.update((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s])); this.sel.set(null); this.touch(); }
  protected expand(n: Placed) { if (n.shape === 'section') this.toggleSection(n.section); }
  protected short(s: string, n: number) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
  protected diamond(n: Placed) { return `${n.w / 2},0 ${n.w},${n.h / 2} ${n.w / 2},${n.h} 0,${n.h / 2}`; }
  /** An edge of the selected step (its connections are highlighted, the rest fade). */
  protected touches(from: string, to: string) { const s = this.sel(); return !!s && (from === s || to === s); }
  protected dimEdge(from: string, to: string) { const q = this.query().trim(); if (!q) return false; const b = this.view().byId; return !(b.get(from)?.match || b.get(to)?.match); }
  protected docOriginal(id: string) { return `/api/v2/documents/${id}/versions/1/original`; }

  // ── canvas: zoom, fit, pan, search, mini-map, full screen ────────────────
  protected zoomBy(f: number) { this.zoom.set(Math.min(3, Math.max(0.15, this.zoom() * f))); queueMicrotask(() => this.onScroll()); }
  protected wheel(ev: WheelEvent) { if (!ev.ctrlKey) return; ev.preventDefault(); this.zoomBy(ev.deltaY < 0 ? 1.1 : 0.9); }
  protected fit() {
    const b = this.box()?.nativeElement, v = this.view();
    if (!b || !v.w) return;
    // show it all when that stays readable; otherwise fit the width (or stay at a readable size) and let the page scroll
    const zw = (b.clientWidth - 12) / v.w, zAll = Math.min(zw, (b.clientHeight - 12) / v.h);
    this.zoom.set(Math.max(0.2, zAll >= 0.55 ? Math.min(1.4, zAll) : Math.max(0.55, Math.min(zw, 1.2))));
    b.scrollTo({ left: 0, top: 0 });
    queueMicrotask(() => this.onScroll());
  }
  protected onScroll() { const b = this.box()?.nativeElement; if (b) this.scrollPos.set({ x: b.scrollLeft, y: b.scrollTop, w: b.clientWidth, h: b.clientHeight }); }
  protected mapClick(ev: MouseEvent) {
    const svg = ev.currentTarget as SVGSVGElement, b = this.box()?.nativeElement, v = this.view();
    if (!b) return;
    const r = svg.getBoundingClientRect(), s = Math.min(r.width / v.w, r.height / v.h);
    const x = (ev.clientX - r.left - (r.width - v.w * s) / 2) / s, y = (ev.clientY - r.top - (r.height - v.h * s) / 2) / s;
    b.scrollTo({ left: x * this.zoom() - b.clientWidth / 2, top: y * this.zoom() - b.clientHeight / 2, behavior: 'smooth' });
  }
  protected findNext() {
    const hits = this.view().nodes.filter((n) => n.match);
    if (!hits.length) return;
    const i = Math.max(0, hits.findIndex((n) => n.id === this.sel()));
    const n = hits[(i + (this.sel() === hits[i]?.id ? 1 : 0)) % hits.length];
    this.sel.set(n.id);
    const b = this.box()?.nativeElement;
    b?.scrollTo({ left: (n.x + n.w / 2) * this.zoom() - b.clientWidth / 2, top: (n.y + n.h / 2) * this.zoom() - b.clientHeight / 2, behavior: 'smooth' });
  }
  protected toggleFullscreen() {
    const el = this.stage()?.nativeElement;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen(); else void el.requestFullscreen().catch(() => { this.bad.set(true); this.msg.set('Full screen was refused by the browser.'); });
  }
  protected panStart(ev: PointerEvent) {
    const t = ev.target as Element, b = this.box()?.nativeElement;
    if (!b || t.closest('.wd-node, .wd-edge')) return;
    this.pan = { x: ev.clientX, y: ev.clientY, sl: b.scrollLeft, st: b.scrollTop }; this.panning.set(true);
  }

  // ── editing ───────────────────────────────────────────────────────────────
  /** After any change: re-check and (for a draft) store it, debounced. */
  protected touch() {
    this.rev.update((x) => x + 1);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const g = this.g(); if (!g) return;
      try {
        if (this.draft()?.state === 'ready' && !this.previewing()) await this.persist(false);
        else if (!this.draft()) { const v = await this.kb.post<View>('/workflows/check', { graph: g }); this.problems.set(v.problems); this.paths.set(v.paths); this.mermaid.set(v.mermaid); }
      } catch (e) { this.bad.set(true); this.msg.set(`Could not store the change: ${(e as Error).message} It is still on the page; edit again or use Save version to retry.`); }
    }, 500);
  }
  private async persist(newVersion: boolean, reason = '') {
    const d = this.draft(), g = this.g();
    if (!d || !g) return;
    const v = await this.kb.request<DraftView>('PUT', `/workflow-drafts/${d.id}`, { graph: g, detail: this.detail(), overlay: this.overlay(), collapsed: this.collapsed(), newVersion, reason });
    this.draft.set(v.draft); this.dversions.set(v.versions); this.problems.set(v.problems); this.paths.set(v.paths); this.mermaid.set(v.mermaid);
    if (this.doc() && v.doc) this.doc.set({ ...this.doc()!, compare: v.doc.compare });
  }
  protected edited(n: WNode) { if (n.basis === 'documented') n.basis = 'proposed'; this.touch(); }
  /** Arrange: back to the automatic layout (positions dragged by hand are forgotten). */
  protected relayout() {
    const g = this.g(); if (!g) return;
    for (const n of g.nodes) n.pinned = false;
    this.rev.update((x) => x + 1); this.touch(); queueMicrotask(() => this.fit());
  }
  protected add(type: NodeType) {
    const g = this.g(); if (!g) return;
    const ids = new Set(g.nodes.map((n) => n.id));
    let i = g.nodes.length + 1; while (ids.has(`n${i}`)) i++;
    const s = this.selNode() as WNode | null;
    const node: WNode = { id: `n${i}`, type, label: type === 'decision' ? 'Condition?' : type === 'exception' ? 'Exception' : 'New step', role: '', transaction: '', basis: 'proposed', note: '', x: (s?.x ?? 400) + 30, y: (s?.y ?? 40) + 110, section: s?.section, lane: s?.lane };
    g.nodes.push(node);
    if (s && s.type !== 'end') g.edges.push({ from: s.id, to: node.id, label: '', kind: 'sequence' });
    this.sel.set(node.id); this.selEdge.set(null); this.touch();
  }
  protected startConnect() { this.connectFrom.set(this.connectFrom() ? null : this.sel()); }
  protected pick(n: Placed) {
    const from = this.connectFrom();
    const g = this.g();
    if (from && g && from !== n.id && n.node) {
      if (!g.edges.some((e) => e.from === from && e.to === n.id)) g.edges.push({ from, to: n.id, label: '', kind: 'sequence' });
      this.connectFrom.set(null); this.selEdge.set(null); this.sel.set(null); this.touch(); return;
    }
    this.sel.set(n.id); this.selEdge.set(null);
  }
  protected pickEdge(i: number) { if (i < 0) return; this.selEdge.set(i); this.sel.set(null); }
  protected remove() {
    const g = this.g(); if (!g) return;
    const id = this.sel(), ei = this.selEdge();
    if (id && !id.startsWith('sec:')) { g.nodes = g.nodes.filter((n) => n.id !== id); g.edges = g.edges.filter((e) => e.from !== id && e.to !== id); this.sel.set(null); }
    else if (ei !== null && g.edges[ei]) { g.edges.splice(ei, 1); this.selEdge.set(null); }
    this.touch();
  }
  protected grab(ev: PointerEvent, n: Placed) {
    const g = this.g();
    if (!n.node || !g || !(g.format === 'flowchart' || g.format === 'sections')) return;
    const svg = (ev.currentTarget as SVGGElement).ownerSVGElement!;
    const p = this.point(ev, svg);
    // from now on the boxes stay where they are (the picture on screen becomes the saved positions)
    if (!g.nodes.some((x) => x.pinned)) { const pos = this.view().byId; for (const x of g.nodes) { const q = pos.get(x.id); if (q) { x.x = Math.round(q.x); x.y = Math.round(q.y); } x.pinned = true; } }
    this.dragging = { id: n.id, dx: p.x - n.x, dy: p.y - n.y, svg };
  }
  protected move(ev: PointerEvent) {
    if (this.pan) { const b = this.box()?.nativeElement; if (b) { b.scrollLeft = this.pan.sl - (ev.clientX - this.pan.x); b.scrollTop = this.pan.st - (ev.clientY - this.pan.y); } return; }
    if (!this.dragging) return;
    const n = this.g()?.nodes.find((x) => x.id === this.dragging!.id);
    if (!n) return;
    const p = this.point(ev, this.dragging.svg);
    n.x = Math.max(0, Math.round(p.x - this.dragging.dx)); n.y = Math.max(0, Math.round(p.y - this.dragging.dy));
    this.rev.update((x) => x + 1);
  }
  protected drop() {
    if (this.pan) { this.pan = null; this.panning.set(false); return; }
    if (this.dragging) { this.dragging = null; this.touch(); }
  }
  private point(ev: PointerEvent, svg: SVGSVGElement) { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) / this.zoom(), y: (ev.clientY - r.top) / this.zoom() }; }

  // ── saving, versions, export ──────────────────────────────────────────────
  protected async save() {
    try { const r = await this.kb.post<{ id: string; version: number }>('/workflows/save', { graph: this.g() }); this.bad.set(false); this.msg.set(`Saved ${r.id} version ${r.version} as Draft. Approve it in the Rulebook to make it confirmed.`); await this.open(r.id); }
    catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
  }
  protected async saveVersion() {
    this.busy.set(true);
    try { await this.persist(true, 'Saved as a version in the designer'); this.previewing.set(null); this.bad.set(false); this.msg.set(`Saved as version ${this.draft()?.version}.`); }
    catch (e) { this.bad.set(true); this.msg.set(`${(e as Error).message} Your changes are still on the page.`); }
    finally { this.busy.set(false); }
  }
  protected async saveToLibrary() {
    const d = this.draft(); if (!d) return;
    this.busy.set(true);
    try {
      await this.persist(true, 'Saved to the library');
      const r = await this.kb.post<DraftView & { entryId: string; version: number }>(`/workflow-drafts/${d.id}/save`, {});
      this.draft.set(r.draft); this.dversions.set(r.versions); this.bad.set(false);
      this.msg.set(`Saved to the library as ${r.entryId} version ${r.version} (Draft). It is not an approved WFX process until an approver approves it in the Rulebook.`);
    } catch (e) { this.bad.set(true); this.msg.set(`${(e as Error).message} The draft is still stored here.`); }
    finally { this.busy.set(false); }
  }
  protected async moveTo(to: string) {
    const d = this.draft(); if (!d?.entryId) return;
    try { await this.kb.post(`/entries/${encodeURIComponent(d.entryId)}/transition`, { version: d.savedVersion, to, reason: `From the workflow designer (${d.id})` }); await this.loadDraft(d.id); this.bad.set(false); this.msg.set(`${d.entryId} is now ${to}.`); }
    catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
  }
  protected async undo() {
    const d = this.draft(); if (!d) return;
    this.busy.set(true);
    try { this.setDraft(await this.kb.post<DraftView>(`/workflow-drafts/${d.id}/undo`, {})); this.bad.set(false); this.msg.set('Went back to the previous version (kept as a new version).'); }
    catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  protected async retryGeneration() {
    const d = this.draft(); if (!d) return;
    if (d.state === 'ready' && !confirm('Build this workflow again from the original request? Your current version stays in the version history.')) return;
    this.busy.set(true);
    try { this.setDraft(await this.kb.post<DraftView>(`/workflow-drafts/${d.id}/retry`, {})); this.bad.set(false); this.msg.set('Generated again from the request.'); }
    catch (e) { this.bad.set(true); this.msg.set(`${(e as Error).message} Your request is kept; you can retry.`); }
    finally { this.busy.set(false); }
  }
  protected async previewVersion(v: number) {
    const d = this.draft(); if (!d) return;
    try { const r = await this.kb.get<{ doc: Doc }>(`/workflow-drafts/${d.id}/versions/${v}`); this.doc.set(r.doc); this.g.set(r.doc.graph); this.detail.set(r.doc.detail); this.overlay.set(r.doc.overlay); this.collapsed.set(r.doc.collapsed); this.previewing.set(v); this.sel.set(null); this.rev.update((x) => x + 1); }
    catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
  }
  protected async compareDraft(v: number) { const d = this.draft(); if (d) this.cmp.set(await this.kb.get<Record<string, string[]>>(`/workflow-drafts/${d.id}/compare?a=${v}&b=${d.version}`)); }
  protected async compare() { const g = this.g(); if (g?.id) this.cmp.set(await this.kb.get<Record<string, string[]>>(`/workflows/${encodeURIComponent(g.id)}/compare?a=${this.va}&b=${this.vb}`)); }
  protected async copyMermaid() { try { await navigator.clipboard.writeText(this.mermaid()); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); } catch { /* blocked */ } }
  private fileName(ext: string) { const g = this.g(); return `${((g?.id || g?.name) ?? 'workflow').replace(/[^\w-]+/g, '-')}-${g?.format ?? 'flowchart'}.${ext}`; }
  private download(name: string, type: string, data: BlobPart) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  protected exportJson() {
    const g = this.g(); if (!g) return;
    this.download(this.fileName('json'), 'application/json', JSON.stringify({ ...g, problems: this.problems(), testPaths: this.paths(), mermaid: this.mermaid(), selection: this.doc()?.selection }, null, 2));
  }
  /** The drawing as it is shown now (picture, collapsed sections), with its colours written into the file. */
  private svgText(): string | null {
    const el = document.getElementById('wd-svg'); const v = this.view();
    if (!el) return null;
    const style = 'text{font-family:system-ui,sans-serif;fill:#222}.wd-text{font-size:12px}.wd-role{font-size:10px;fill:#666}.wd-node rect,.wd-node polygon,.wd-node circle{fill:#fff;stroke:#444;stroke-width:1.5}.wd-node[data-basis=proposed] rect,.wd-node[data-basis=proposed] polygon{stroke-dasharray:6 4}.wd-node[data-basis=inferred] rect,.wd-node[data-basis=inferred] polygon{stroke-dasharray:2 3}.wd-node[data-shape=decision] polygon,.wd-node[data-shape=gateway-x] polygon,.wd-node[data-shape=gateway-plus] polygon{fill:#fdf1d6}.wd-node[data-type=start] rect,.wd-node[data-type=end] rect{fill:#e3f1ff}.wd-glyph{stroke:#444;stroke-width:2.5;fill:none}.wd-thick{stroke-width:4}.wd-solid{fill:#444}.wd-stack{fill:#eee}.wd-edge path{fill:none;stroke:#555;stroke-width:1.6}.wd-edge[data-kind=optional] path,.wd-edge[data-kind=dependency] path{stroke-dasharray:6 4}.wd-edge[data-kind=data] path{stroke-dasharray:2 3}.wd-edge[data-kind=parallel] path{stroke:#2a6;stroke-width:2.6}.wd-hit{stroke:transparent!important}.wd-arrowhead{fill:#555}.wd-elabel{font-size:11px;fill:#1f4f8f}.wd-lane rect{fill:#f7f7f7;stroke:#ddd}.wd-lane.alt rect{fill:#fff}.wd-lane-head{fill:#eceff3!important}.wd-lane-name{font-size:12px;font-weight:600}.wd-badge rect{fill:#ddd;stroke:none}.wd-badge.on rect{fill:#cfe9d6}.wd-badge text{font-size:10px}.wd-axis{stroke:#555;stroke-width:2}.wd-rootbox{fill:#ffe6d6!important}.wd-storebg{fill:#fff;stroke:none!important}.wd-storeline{stroke:#444;stroke-width:1.5;fill:none}';
    const clone = el.cloneNode(true) as SVGElement;
    clone.setAttribute('width', String(v.w)); clone.setAttribute('height', String(v.h));
    clone.insertAdjacentHTML('afterbegin', `<style>${style}</style><rect width="100%" height="100%" fill="#ffffff"/>`);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}`;
  }
  protected exportSvg() { const t = this.svgText(); if (t) this.download(this.fileName('svg'), 'image/svg+xml', t); }
  protected exportPng() {
    const t = this.svgText(), v = this.view(); if (!t) return;
    const img = new Image(), url = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'), s = Math.min(2, 8000 / Math.max(v.w, v.h));
      c.width = Math.round(v.w * s); c.height = Math.round(v.h * s);
      const x = c.getContext('2d'); if (!x) return;
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { if (b) this.download(this.fileName('png'), 'image/png', b); }, 'image/png');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { this.bad.set(true); this.msg.set('The picture could not be turned into a PNG in this browser; use SVG.'); };
    img.src = url;
  }
  /** PDF through the browser's print dialog ("Save as PDF"), with the drawing alone on the page. */
  protected exportPdf() {
    const t = this.svgText(); if (!t) return;
    const w = window.open('', '_blank');
    if (!w) { this.bad.set(true); this.msg.set('The browser blocked the print window; allow pop-ups for this page, or use SVG / PNG.'); return; }
    w.document.write(`<!doctype html><title>${this.g()?.name ?? 'Workflow'}</title><style>@page{size:landscape;margin:10mm}body{margin:0}svg{width:100%;height:auto}</style>${t.replace(/^<\?xml[^>]*>\s*/, '')}`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
}
