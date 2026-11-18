// Live recorder for WFX. Injected into the WFX tab; read-only – it never clicks, types or submits.
// The WFX Content-Security-Policy blocks connections to localhost, so events stay in the page:
//   __wfxRec2.poll(cursor) → compact summaries of new events,  __wfxRec2.get(i) → full event.
(() => {
  if (window.__wfxRec2) return 'already running';
  const ACTION = /save|submit|confirm|approve|generate|create|post|add|delete|cancel|close|update|proceed|next|release|link|allocate|run|process|send|ok\b|yes\b/i;
  const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const events = [];
  let n = 0;
  const send = (ev) => { events.push({ i: n++, at: new Date().toISOString(), ...ev }); if (events.length > 2000) events.splice(0, 500); };
  const summary = (e) => {
    if (e.type !== 'snapshot') return e;
    const fields = e.frames.flatMap((f) => f.fields).filter((f) => f.value).map((f) => `${f.label}=${f.value}`);
    const grids = e.frames.flatMap((f) => f.grids).map((g) => ({ header: g.header.slice(0, 14), rows: g.totalRows, first: g.rows[0]?.slice(0, 14) }));
    return { i: e.i, at: e.at, type: e.type, screen: e.screen, reason: e.reason, fieldCount: fields.length, fields: fields.slice(0, 30), grids };
  };
  const visible = (el) => {
    try {
      const r = el.getBoundingClientRect();
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    } catch { return false; }
  };
  const labelFor = (el) => {
    const doc = el.ownerDocument;
    try {
      if (el.id) { const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && clean(l.innerText)) return clean(l.innerText); }
    } catch { /* ignore */ }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const wrap = el.closest('mat-form-field, .form-group, [class*="form-field"], [class*="field-wrap"]');
    if (wrap) { const l = wrap.querySelector('label, mat-label, .label'); if (l && clean(l.innerText)) return clean(l.innerText); }
    const td = el.closest('td');
    if (td) { let p = td.previousElementSibling; while (p && !clean(p.innerText)) p = p.previousElementSibling; if (p) return clean(p.innerText).slice(0, 80); }
    let p = el.previousElementSibling;
    for (let i = 0; i < 3 && p; i++, p = p.previousElementSibling) if (clean(p.innerText)) return clean(p.innerText).slice(0, 80);
    const parentText = clean(el.parentElement?.innerText);
    if (parentText && parentText.length < 60) return parentText;
    return el.placeholder || el.name || el.id || '';
  };
  const valueOf = (el) => {
    if (el.tagName === 'SELECT') return clean(el.options[el.selectedIndex]?.text ?? '');
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'Yes' : 'No';
    return clean(el.value);
  };
  const allDocs = () => {
    const out = [];
    const walk = (doc, path) => {
      out.push({ doc, path });
      for (const f of doc.querySelectorAll('iframe, frame')) {
        try { if (f.contentDocument && f.contentDocument.location.href !== 'about:blank') walk(f.contentDocument, `${path} > ${f.id || f.name || 'frame'}`); } catch { /* cross-origin */ }
      }
    };
    walk(document, 'top');
    return out;
  };
  const readDoc = ({ doc, path }) => {
    const fields = [];
    for (const el of doc.querySelectorAll('input, select, textarea')) {
      if (['hidden', 'button', 'submit', 'image', 'reset', 'file', 'password'].includes(el.type) || !visible(el)) continue;
      if (el.closest('table') && el.closest('table').rows.length > 3 && el.closest('tr')?.parentElement?.tagName === 'TBODY' && el.closest('table').querySelector('th')) continue;
      const label = labelFor(el); const value = valueOf(el);
      if (!label && !value) continue;
      fields.push({ label, value, readOnly: el.readOnly || el.disabled || undefined });
    }
    const grids = [];
    for (const t of doc.querySelectorAll('table')) {
      if (!visible(t) || t.querySelector('table')) continue;
      const rows = [...t.rows].filter(visible).map((r) => [...r.cells].map((c) => {
        const inp = c.querySelector('input:not([type=hidden]):not([type=button]), select, textarea');
        return clean(inp ? valueOf(inp) : c.innerText).slice(0, 120);
      }));
      if (rows.length < 2 || rows[0].length < 3) continue;
      grids.push({ id: t.id || undefined, header: rows[0], rows: rows.slice(1, 80), totalRows: rows.length - 1 });
    }
    for (const g of doc.querySelectorAll('[role="grid"], .ag-root')) {
      if (!visible(g)) continue;
      const header = [...g.querySelectorAll('[role="columnheader"]')].map((h) => clean(h.innerText));
      const rows = [...g.querySelectorAll('[role="row"]')].map((r) => [...r.querySelectorAll('[role="gridcell"]')].map((c) => clean(c.innerText).slice(0, 120))).filter((r) => r.length);
      if (header.length && rows.length) grids.push({ header, rows: rows.slice(0, 80), totalRows: rows.length });
    }
    const headings = [...doc.querySelectorAll('h1, h2, h3, h4, .page-title, .header-title, .pageHeader, [class*="PageTitle" i], [class*="page-heading" i]')]
      .filter(visible).map((h) => clean(h.innerText)).filter((t) => t && t.length < 90).slice(0, 8);
    return { path, url: doc.location?.href, title: doc.title, headings, fields, grids };
  };
  const screenName = (frames) => {
    const inner = [...frames].reverse().find((f) => f.fields.length || f.grids.length) ?? frames[frames.length - 1];
    return inner?.headings[0] || inner?.title || (inner?.url ?? '').split('?')[0].split('/').pop() || 'screen';
  };
  let lastSig = '';
  const snapshot = (reason) => {
    try {
      const frames = allDocs().map(readDoc).filter((f) => f.fields.length || f.grids.length || f.headings.length);
      const screen = screenName(frames);
      const sig = JSON.stringify(frames.map((f) => [f.url, f.fields, f.grids.map((g) => g.rows)]));
      if (sig === lastSig && !/after/.test(reason)) return;
      lastSig = sig;
      rec.screen = screen;
      send({ type: 'snapshot', reason, screen, topUrl: location.href, frames });
    } catch (e) { send({ type: 'error', message: String(e) }); }
  };
  const timers = {};
  const later = (key, fn, ms) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };

  const attach = (doc) => {
    if (doc.__wfxRec2) return;
    doc.__wfxRec2 = true;
    doc.addEventListener('change', (e) => {
      const el = e.target;
      if (!el || !el.tagName || el.type === 'password') return;
      send({ type: 'field', screen: rec.screen, label: labelFor(el), value: valueOf(el), url: doc.location.href });
    }, true);
    doc.addEventListener('click', (e) => {
      const b = e.target.closest?.('button, a, input[type=button], input[type=submit], [role=button], .btn');
      if (!b) return;
      const label = clean(b.innerText || b.value || b.title || b.getAttribute('aria-label')).slice(0, 60);
      if (!label || !ACTION.test(label)) return;
      send({ type: 'action', screen: rec.screen, label, url: doc.location.href });
      later('after', () => snapshot(`after "${label}"`), 3000);
    }, true);
    const win = doc.defaultView;
    if (win && !win.__wfxOpenWrapped2) {
      win.__wfxOpenWrapped2 = true;
      const open = win.open;
      win.open = function (...args) { send({ type: 'popup', url: String(args[0] ?? '') }); return open.apply(this, args); };
    }
  };

  const urls = new Map();
  const tick = () => {
    for (const { doc, path } of allDocs()) {
      attach(doc);
      const u = doc.location?.href;
      if (urls.get(path) !== u) {
        urls.set(path, u);
        later('load', () => snapshot('screen opened'), 2000);
      }
    }
  };
  const rec = {
    screen: '', snapshot, events,
    stop: () => clearInterval(rec.timer),
    poll: (cursor = 0) => ({ cursor: events.length ? events[events.length - 1].i + 1 : cursor, events: events.filter((e) => e.i >= cursor).map(summary) }),
    get: (i) => events.find((e) => e.i === i),
  };
  rec.timer = setInterval(tick, 1000);
  window.__wfxRec2 = rec;
  send({ type: 'hello', url: location.href });
  tick();
  return 'recorder started';
})();
