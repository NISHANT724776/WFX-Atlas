# Design-system audit — WFX Knowledge Hub (step 1, before any change)

Date: 2026-11-18. Read: `src/styles.scss` (1,122 lines), `src/platform.scss` (275), all 81 component/template files under `src/app`, `package.json`, `angular.json`; the UI pack `wfx-ui-pack.zip` (tokens, typography, motion, icons, brand, fonts, styleguide, renders). Walked `/`, `/workflows`, `/data-model`, `/theory`, `/calculations`, `/data`, `/assistant` on http://192.168.100.196:8787 at 1280 wide; the signed-in Knowledge pages (Dashboard, Library, Rulebook, Transactions, Calc Lab, BA Copilot, Profile) were reviewed earlier today on the test copy (same build). Numbers below come from a scanner run over the source, not from estimates.

## 1. Tokens actually in use

The app has its own token set (prefix-less), two themes (light = "paper" default in `:root`, dark = "ink" via `prefers-color-scheme` **and** `[data-theme='dark']`):

| Role | App light | App dark | Your estimate (dark) | Pack dark | Pack light |
|---|---|---|---|---|---|
| canvas | `--bg #f3efe7` | `#11100e` | `#0E0D0C` | `#0E0D0C` | `#FAF7F4` |
| surface | `--surface #fbf9f5` | `#1a1916` | `#161413` | `#161413` | `#FFFFFF` |
| surface-2 | `#ebe5d9` | `#24221e` | `#1F1C1A` | `#1F1C1A` | `#F3EEE9` |
| hairline | `--border #ddd5c6` → **redefined** `#e3dccf` | `#33302a` → **redefined** `#2e2b26` | `#2A2624` | `#2A2624` | `#E3DBD4` |
| ink | `--text #1b1916` | `#f2ede4` | `#F2EEEA` | `#F2EEEA` | `#171412` |
| ink-2 | `--muted #6d665b` | `#a39b8d` | `#A39B95` | `#A79F99` | `#5A534E` |
| ink-3 | — (none) | — | `#6B635E` | `#8A827B` | `#766D67` |
| accent | `--accent #e0532b` | `#ff6a3d` | `#F2683C` | `#F2683C` | `#C8400F` |
| accent-dim | `--accent-soft #f8dfd4` | `#3a1c12` | `#7A3420` | `#7A3420` | `#E8A289` |
| link (≠ accent) | `--link #b8401d` | `#ff8a63` | — | — | — |
| ok / warn / bad (+ "-soft") | 6 tokens | 6 tokens | — | ok, warn only | ok, warn only |

**Drift and problems found**
- **Two token layers in one file.** `styles.scss` line ~689 starts a "refinement" layer that redefines `--border` and `--shadow` (4 definitions each) and **re-declares 64 selectors** (`.card`, `.hero`, `.page-head`, `.eyebrow`, `.badge`, `.tabs`, `.site-header` …). `platform.scss` re-declares 12 more (mine, from today's declutter passes). The rendered value is whichever came last.
- **`.eyebrow` is defined twice with different colours** (accent at line 90, muted at 704).
- **Your ink-3 `#6B635E` is 3.12:1 on surface** — fails 4.5:1 for eyebrow text. The pack's `#8A827B` (4.86:1) is correct.
- **Your "Not ordered" `#4A4440` is 1.92:1 on surface and "PO created" `#8A5A3C` is 3.16:1** — the first fails the 3:1 rule for state colours. The pack's ramp (`#6E6560 · #A96B41 · #D4873F · #F2683C`, all ≥3.2:1; light pair all ≥4.8:1) keeps the warm sequential idea and passes. I recommend the pack's values.
- **Light accent `#e0532b` on surface is 3.67:1** — fails for text. Pack light accent `#C8400F` is 5.0:1.
- **Name collision:** the data-model "document frame" already uses `--wfx-head, --wfx-line, --wfx-teal, --wfx-text, --wfx-muted` (4 definitions each). The pack's tokens are all `--wfx-*`. These must be renamed (`--doc-*`) before the pack is imported.
- No ink-3, no state ramp, no spacing scale, no type scale, no duration/easing tokens beyond one `--ease`, one `--radius`.

## 2. Hardcoded values (not from a token)

| Kind | Total | Distinct | Worst offenders |
|---|---|---|---|
| Colours | 46 | 25 | `#fff` ×14 (text on accent, overlays), shadows `rgba(0,0,0,…)` ×8, `#ff5a1f` ×2 (my guide markers), blue info `#dbe7f7/#1f4f8f` (documented status), WFX-frame greys `#1a1f26 #2e3640 #d9dee4 #c9d0d8`, `#138c9a` teal, `#d97706`; 8 hex in `workflow-designer.ts` (lane/edge colours). By file: styles.scss 29, platform.scss 14, index.html 2 (theme-color). |
| Font sizes | 246 | **49** | 0.86 / 0.82 / 0.8 / 0.78 / 0.9 / 0.72 / 0.74 / 0.85 / 0.7 rem … plus px values 10/10.5/11/11.5/12/13 px. Your 8-step scale (72/48/32/24/18/15/13/11) covers none of them exactly except 1.5rem. |
| Spacing | 1,065 | **61** | 8 ×131, 10 ×123, 6 ×117, 12 ×114, 4 ×107, 14 ×74, 16 ×70, 2 ×53, 18 ×41, 20 ×28 … also 84/88/90/100/120 px. Off-scale values (6, 10, 14, 18, 20, 22, 28 …) are ~45 % of all spacing. |
| Durations | 126 | **19** | 0.2s ×43, 0.25s ×19, 0.3s ×18, 0.5s ×9, 0.35s ×8, 0.45s ×6, 0.6s ×4, plus 1.2s, 1.6s, 2.2s, 4.8s loops. 22 declarations exceed 400 ms. |
| Radii | — | 20 | 999px, 12, 50 %, 8, 10, 14, 18, 6, 16, 4, 20, 9, 2 and asymmetric ones. |
| box-shadow | 41 | — | ad-hoc; the pack says dark = hairline not shadow, light = two elevation tokens. |

Font families are already tokenised (`--serif` ×16, `--mono` ×5, `--sans` ×5 uses) — good. Inline `style=""` attributes: 0. Component `styles: []` blocks: 0 (all CSS is global).

## 3. What is installed for styling and motion

- Styling: SCSS (Angular build), no CSS framework. Fonts from npm: `@fontsource-variable/inter`, `@fontsource/instrument-serif` (400 + italic). Mono = system `ui-monospace / Cascadia / Consolas`.
- Motion: **no motion library** (good — the pack needs none). One directive `shared/reveal.ts` (IntersectionObserver fade-up with `--reveal-delay`), CSS transitions, a few keyframe loops (storyboard runner, data-model pick pulse, my typing dots).
- **Reduced motion today = "nothing happens"**: `styles.scss` sets every animation/transition to 0.01 ms. The brief asks for a 120 ms cross-fade with a legible end state.
- `tabular-nums` appears in 10 rules only; most quantities (cost sheet, data tables, sim panel, KPI tiles) inherit proportional Inter digits.

## 4. The same component implemented more than once

| Component | Implementations |
|---|---|
| Chat / answer UI | 4: floating `shared/chat-widget.ts`, v1 page thread `shared/chat-thread.ts` (guest `/assistant`), `pages/ask.ts` (`/ask` with its own answer renderer), `platform/kb-assistant.ts` + `KbAnswerView` (signed-in). |
| Status badge | 5 class families: `.badge` (verified / assumed / kind-*), `.kb-badge`, `.kb-status`, `.kb-src-status`, plus the `kind-badge.ts` component and `.chip`. "Verified" vs "To confirm" is today a colour swap (`.badge.verified` green, `.badge.assumed` amber). |
| Segmented control / tabs | 7: `.tabs button`, `.seg`, `.seg-sm`, `.chip-link.on`, `.chip-btn.on`, `section-switch.ts` (`.sec-switch`), designer `.wd-*` toggles. |
| Card | 12: `.card`, `.link-card`, `.side-card`, `.rail-card`, `.theory-card`, `.calc-card`, `.formula-card`, `.table-card`, `.kb-panel`, `.dm-card`, `.wd-card`, `.gd`. |
| Module tile | 3: home tiles (`home.ts`), `module-picker.ts` (data-model, theory, calculations), `/data` area tiles (`data-explorer.ts`). |
| Icons | 1 dictionary (`shared/icon.ts`, ~30 paths, 24 grid, mixed weights) + inline SVG in the designer, blueprint and storyboard. Module icons are generic (gear, cube, cart, chart …). |
| Empty / loading states | ad hoc `<p class="muted">…</p>` in ~15 places (e.g. `/data` "Getting the data ready…"). |

## 5. Accent rule ("one orange moment per viewport") — current violations seen live

- `/data`: all **10** area icons are orange at rest.
- `/workflows`: every selected step chip (19) is orange.
- `/`: hero italic + four orange nodes in the motif + orange Ask button + orange chat bubble.
- The floating chat bubble is orange on every page, so every viewport starts with one accent already used.
- Eyebrows are orange in one rule and grey in another (see §1).

## 6. Things the pack has no answer for (need your decision)

1. **Error / conflict colour.** The app uses `--bad` for errors, conflicting sources and rejected rules; the pack has only ok / warn. Proposal: add `--wfx-bad` (dark `#E5786E`, light `#B3261E`, both ≥4.5:1) to `tokens.css` and the styleguide.
2. **"Documented in a source" blue** (`#dbe7f7 / #1f4f8f`) used by the assistant's knowledge status. Proposal: drop blue; use ink-2 on surface-2 (neutral) so only confirmed (ok) and unconfirmed (warn) carry colour.
3. **Link colour separate from accent.** Today links are a darker orange in both themes, which spends the accent on every link. Proposal: links in ink with an underline; accent only on hover/focus.
4. **Workflow designer diagram colours** (lanes, edge kinds, overlays — 8 hex values). Proposal: map to surface-2/3, hairline-str, ink-2 and the state ramp; no new hues.
5. **WFX "document frame" tokens** on `/data-model` (teal header mimicking the real WFX screen). Proposal: keep as a deliberate quotation of the WFX UI, rename to `--doc-*`, document it in the styleguide.
6. **Icon stroke cap.** Your brief says *square cap*; the pack's icons are drawn with *round cap and join*. One of them has to win. (The pack's set reads well at 16 px; square caps would mean redrawing all ten.)
7. **Dark-first.** The pack is dark-default with light as `[data-theme=light]`; the app is light-default following the OS. Proposal: keep the OS default and the toggle exactly as now (no behaviour change), map both themes onto the pack's pairs.

## 7. Choices that would block the later features (timeline scrubber, animated bars, formula x-ray)

None in the pack. Two in the app to avoid making worse: (a) numbers rendered in proportional Inter will jitter when they tween — fixed by Plex Mono + tabular-nums; (b) the reduced-motion rule kills transitions entirely, which would also kill state-change feedback the scrubber needs — fixed by the 120 ms cross-fade.

## 8. Proposed consolidation (nothing applied yet)

1. **One scale.** Import the pack's `tokens.css`, `typography.css`, `motion.css` at the app root. Map the existing names (`--bg --surface --text --muted --border --accent …`) to `var(--wfx-…)` for one transition commit, then replace usages file by file and delete the old names — no parallel scale survives. Delete the "refinement" layer by folding its winning values into the first definition.
2. **Fonts.** Fraunces (display only, ≥24 px), Inter (UI, from the pack's file — remove `@fontsource-variable/inter`), IBM Plex Mono (every quantity, code, formula, with tabular-nums). Remove `@fontsource/instrument-serif`. Fonts copied to `public/fonts/`, preload Inter + Fraunces.
3. **Snap to scale.** Font sizes 49 → 8 steps; spacing 61 → 4/8/12/16/24/40/64/96 (2 px kept only for hairline offsets); radii 20 → 4 tokens; durations 19 → 3 + stagger + lag; shadows → 2 elevation tokens.
4. **Components** (styling only, no behaviour change): one card, one badge (Verified / To confirm per the styleguide, open question on hover/focus), one segmented control, one module tile, one lifecycle chip (four states + connectors) used by the workflow chain, the sim panel and the data tables, USER vs SYSTEM step markers, one empty/loading/error state component. The four chat UIs keep their behaviour; they share one stylesheet in this pass (merging their code is a feature change, so I'd only propose it).
5. **Icons.** Pack's 10 module icons replace the module entries in `icon.ts`; all `currentColor`, ink at rest, accent only when selected.
6. **Motion.** Pack primitives (`enter, exit, stagger, value-tween (spring), state-change (cause → effect 80 ms), shimmer for SYSTEM steps, directional flow once on hover`); `reveal.ts` rebuilt on them; loops > 400 ms removed; reduced motion = 120 ms cross-fade.
7. **`/styleguide` route**, built first and extended with each group (tokens → type → icons → components → motion → states), using the app's real components. This is the one routing change; it adds a route and changes no existing one.

**Order of review** (one group at a time, shown in `/styleguide` before moving on): tokens + type → icons + brand → lifecycle chip, step markers, badges → empty/loading/error states + hero motif → motion primitives → application to pages → quality bar (contrast both themes, keyboard path, 1280/390, no hardcoded values).
