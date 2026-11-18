/* ==========================================================================
   WFX Knowledge Hub — motion helpers
   Vanilla, no dependencies, no build step. Import as a module or drop in a
   <script>. Everything here honours prefers-reduced-motion by jumping to the
   end state rather than doing nothing.
   ========================================================================== */

const REDUCED = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --------------------------------------------------------------------------
   spring — numeric integration, not a bezier.
   Quantities should feel like they have mass. 600 KG arriving should settle,
   not stop dead.
   -------------------------------------------------------------------------- */
export function spring(from, to, onUpdate, opts = {}) {
  const { stiffness = 180, damping = 24, mass = 1, precision = 0.01, onDone } = opts;

  if (REDUCED() || from === to) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }

  let value = from;
  let velocity = 0;
  let raf = null;
  let last = performance.now();

  const tick = (now) => {
    // clamp dt so a backgrounded tab doesn't explode the integrator
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    const force = -stiffness * (value - to);
    const drag = -damping * velocity;
    velocity += ((force + drag) / mass) * dt;
    value += velocity * dt;

    if (Math.abs(to - value) < precision && Math.abs(velocity) < precision) {
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(value);
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);
  return () => raf && cancelAnimationFrame(raf);
}

/* --------------------------------------------------------------------------
   tweenValue — animate the number inside an element.
   Marks it with .wfx-value-changed so the accent pulse fires in CSS.

     tweenValue(el, 1100, { decimals: 0, suffix: ' KG' })
   -------------------------------------------------------------------------- */
export function tweenValue(el, to, opts = {}) {
  const {
    from = parseFloat(String(el.dataset.value ?? el.textContent).replace(/[^\d.-]/g, '')) || 0,
    decimals = 0,
    prefix = '',
    suffix = '',
    locale = 'en-IN',
    pulse = true,
  } = opts;

  const fmt = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (pulse) {
    el.classList.remove('wfx-value-changed');
    void el.offsetWidth;            // restart the animation
    el.classList.add('wfx-value-changed');
  }

  return spring(from, to, (v) => {
    el.textContent = prefix + fmt.format(v) + suffix;
    el.dataset.value = String(v);
  }, {
    ...opts,
    onDone: () => { el.dataset.value = String(to); opts.onDone?.(); },
  });
}

/* --------------------------------------------------------------------------
   sequence — cause then effect, 80ms apart.
   Pass the steps in causal order. This is the single most important helper
   in the file: it is what makes the simulator teach rather than just update.

     sequence([
       () => chip.dataset.state = 'grn',        // cause
       () => tweenValue(adjusted, 400),          // effect 1
       () => tweenValue(stillToBuy, 1100),       // effect 2
     ]);
   -------------------------------------------------------------------------- */
export function sequence(steps, lagMs) {
  const lag = lagMs ?? (REDUCED() ? 0 : readLag());
  steps.forEach((fn, i) => {
    if (i === 0 || lag === 0) fn();
    else setTimeout(fn, i * lag);
  });
}

function readLag() {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--wfx-lag')
    .trim();
  return parseFloat(v) || 80;
}

/* --------------------------------------------------------------------------
   reveal — run the enter animation when an element scrolls into view, once.
   Re-entering a route should not replay it; that is why it unobserves.
   -------------------------------------------------------------------------- */
export function reveal(selector = '[data-reveal]', opts = {}) {
  const { rootMargin = '0px 0px -10% 0px', threshold = 0.15 } = opts;
  const nodes = document.querySelectorAll(selector);

  if (REDUCED() || !('IntersectionObserver' in window)) {
    nodes.forEach((n) => n.classList.add('wfx-enter-fade'));
    return () => {};
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add(entry.target.dataset.reveal === 'stagger'
        ? 'wfx-stagger'
        : 'wfx-enter');
      io.unobserve(entry.target);
    });
  }, { rootMargin, threshold });

  nodes.forEach((n) => io.observe(n));
  return () => io.disconnect();
}

/* --------------------------------------------------------------------------
   drawPath — set --len from the real path length, then run the draw.
   -------------------------------------------------------------------------- */
export function drawPath(pathEl) {
  const len = pathEl.getTotalLength();
  pathEl.style.setProperty('--len', len);
  pathEl.classList.remove('wfx-draw');
  void pathEl.getBoundingClientRect();
  pathEl.classList.add('wfx-draw');
}

/* --------------------------------------------------------------------------
   replay — for the styleguide: re-run whatever animation a node carries.
   -------------------------------------------------------------------------- */
export function replay(el) {
  const classes = [...el.classList].filter((c) => c.startsWith('wfx-'));
  el.classList.remove(...classes);
  void el.offsetWidth;
  el.classList.add(...classes);
}

export default { spring, tweenValue, sequence, reveal, drawPath, replay };
