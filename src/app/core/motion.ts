// Motion primitives (from wfx-ui-pack/design-system/motion.js, typed and safe for server rendering).
// Rules: numbers tween, layout snaps; cause then effect 80 ms apart; stagger 40 ms, max 8; tables fade only;
// reduced motion jumps to the end state (the CSS turns animations into a 120 ms cross-fade) — never "nothing happens".
// The CSS half lives in src/design-system/motion.css. Every primitive is demonstrated at /styleguide (section 07).

const hasWindow = () => typeof window !== 'undefined';
export const reducedMotion = () => hasWindow() && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface SpringOptions { stiffness?: number; damping?: number; mass?: number; precision?: number; onDone?: () => void }

/** Integrates a spring from `from` to `to` (stiffness 180, damping 24): quantities settle as if they had mass. Returns cancel. */
export function spring(from: number, to: number, onUpdate: (v: number) => void, opts: SpringOptions = {}): () => void {
  const { stiffness = 180, damping = 24, mass = 1, precision = 0.01, onDone } = opts;
  if (!hasWindow() || reducedMotion() || from === to) { onUpdate(to); onDone?.(); return () => undefined; }
  let value = from, velocity = 0, raf = 0, last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 1 / 30); // a background tab must not explode the integrator
    last = now;
    velocity += ((-stiffness * (value - to) - damping * velocity) / mass) * dt;
    value += velocity * dt;
    if (Math.abs(to - value) < precision && Math.abs(velocity) < precision) { onUpdate(to); onDone?.(); return; }
    onUpdate(value);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export interface TweenOptions extends SpringOptions { from?: number; decimals?: number; prefix?: string; suffix?: string; locale?: string; pulse?: boolean }

/** Animates the number inside an element and marks it .wfx-value-changed (one accent pulse: "this moved"). */
export function tweenValue(el: HTMLElement, to: number, opts: TweenOptions = {}): () => void {
  const from = opts.from ?? (parseFloat(String(el.dataset['value'] ?? el.textContent).replace(/[^\d.-]/g, '')) || 0);
  const fmt = new Intl.NumberFormat(opts.locale ?? 'en-IN', { minimumFractionDigits: opts.decimals ?? 0, maximumFractionDigits: opts.decimals ?? 0 });
  if (opts.pulse !== false && from !== to) restartClass(el, 'wfx-value-changed');
  return spring(from, to, (v) => { el.textContent = (opts.prefix ?? '') + fmt.format(v) + (opts.suffix ?? ''); el.dataset['value'] = String(v); },
    { ...opts, onDone: () => { el.dataset['value'] = String(to); opts.onDone?.(); } });
}

/** Cause then effect: runs the steps in causal order, --wfx-lag (80 ms) apart; all at once under reduced motion. */
export function sequence(steps: (() => void)[], lagMs?: number): () => void {
  const lag = lagMs ?? (reducedMotion() ? 0 : readLag());
  const timers: ReturnType<typeof setTimeout>[] = [];
  steps.forEach((fn, i) => { if (i === 0 || lag === 0) fn(); else timers.push(setTimeout(fn, i * lag)); });
  return () => timers.forEach(clearTimeout);
}
function readLag(): number {
  if (!hasWindow()) return 80;
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wfx-lag')) || 80;
}

let observer: IntersectionObserver | null = null;
/** Runs the enter (or stagger) animation once, when the element scrolls into view. Re-entering never replays it. */
export function revealOnce(el: HTMLElement, kind: 'enter' | 'stagger' = 'enter'): void {
  if (!hasWindow() || !('IntersectionObserver' in window)) return;
  el.dataset['reveal'] = kind;
  el.classList.add('wfx-reveal-wait');
  observer ??= new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const t = e.target as HTMLElement;
      t.classList.remove('wfx-reveal-wait');
      t.classList.add(t.dataset['reveal'] === 'stagger' ? 'wfx-stagger' : 'wfx-enter');
      observer!.unobserve(t);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 });
  observer.observe(el);
}

/** Draws an SVG path from its real length (sets --len, then .wfx-draw). */
export function drawPath(path: SVGPathElement): void {
  path.style.setProperty('--len', String(path.getTotalLength()));
  restartClass(path, 'wfx-draw');
}

/** Re-runs the animation of a class (removing and re-adding it forces a restart). */
export function restartClass(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add(cls);
}

/** Styleguide replay: re-runs every wfx-* animation class an element carries. */
export function replay(el: Element): void {
  const classes = [...el.classList].filter((c) => c.startsWith('wfx-') && c !== 'wfx-reveal-wait');
  el.classList.remove(...classes);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add(...classes);
}
