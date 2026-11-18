// Page reader for WFX screens. Run in the browser pane on the WFX tab; returns one JSON capture.
// Walks the top document and every same-origin frame, and collects:
//  - fields: label → value (inputs, selects, textareas, checkboxes, read-only label/value pairs)
//  - grids: header + rows of visible tables / Angular grids (first 60 rows each)
// Read-only: it never clicks, types or submits anything.
(() => {
  const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const labelFor = (el) => {
    const doc = el.ownerDocument;
    if (el.id) {
      const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    if (el.getAttribute('aria-label')) return clean(el.getAttribute('aria-label'));
    const wrap = el.closest('label, mat-form-field, .form-group, .field, .wfx-field, [class*="form-field"]');
    if (wrap) {
      const t = clean([...wrap.querySelectorAll('label, .label, mat-label, span, div')].map((n) => n.childElementCount ? '' : n.innerText).find((x) => clean(x)) ?? '');
      if (t) return t;
    }
    const td = el.closest('td');
    if (td) {
      let prev = td.previousElementSibling;
      while (prev && !clean(prev.innerText)) prev = prev.previousElementSibling;
      if (prev) return clean(prev.innerText);
    }
    let p = el.previousElementSibling;
    for (let i = 0; i < 3 && p; i++, p = p.previousElementSibling) if (clean(p.innerText)) return clean(p.innerText);
    return el.placeholder || el.name || el.id || '';
  };
  const valueOf = (el) => {
    if (el.tagName === 'SELECT') return clean(el.options[el.selectedIndex]?.text ?? '');
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'Yes' : 'No';
    return clean(el.value);
  };

  const docs = [];
  const walk = (doc, path) => {
    docs.push({ doc, path });
    for (const f of doc.querySelectorAll('iframe, frame')) {
      try { if (f.contentDocument) walk(f.contentDocument, `${path} > ${f.id || f.name || 'frame'}`); } catch { /* cross-origin */ }
    }
  };
  walk(document, 'top');

  const frames = docs.map(({ doc, path }) => {
    const fields = [];
    for (const el of doc.querySelectorAll('input, select, textarea')) {
      if (['hidden', 'button', 'submit', 'image', 'reset', 'file', 'password'].includes(el.type) || !visible(el)) continue;
      if (el.closest('table.grid, [role="grid"], .ag-root, table[id*="grd" i], table[id*="Grid" i]')) continue;
      const label = labelFor(el);
      const value = valueOf(el);
      if (!label && !value) continue;
      fields.push({ label, value, readOnly: el.readOnly || el.disabled || undefined });
    }
    const grids = [];
    for (const t of doc.querySelectorAll('table')) {
      if (!visible(t) || t.querySelector('table')) continue;
      const rows = [...t.rows].filter(visible).map((r) => [...r.cells].map((c) => {
        const inp = c.querySelector('input:not([type=hidden]), select, textarea');
        return clean(inp ? valueOf(inp) : c.innerText);
      }));
      if (rows.length < 2 || rows[0].length < 3) continue;
      grids.push({ id: t.id || undefined, header: rows[0], rows: rows.slice(1, 61), totalRows: rows.length - 1 });
    }
    for (const g of doc.querySelectorAll('[role="grid"], .ag-root')) {
      if (!visible(g)) continue;
      const header = [...g.querySelectorAll('[role="columnheader"]')].map((h) => clean(h.innerText));
      const rows = [...g.querySelectorAll('[role="row"]')].map((r) => [...r.querySelectorAll('[role="gridcell"]')].map((c) => clean(c.innerText))).filter((r) => r.length);
      if (header.length && rows.length) grids.push({ header, rows: rows.slice(0, 60), totalRows: rows.length });
    }
    const headings = [...doc.querySelectorAll('h1, h2, h3, .page-title, .header-title, [class*="title" i]')].filter(visible).map((h) => clean(h.innerText)).filter((t) => t && t.length < 80).slice(0, 8);
    return { path, url: doc.location?.href, title: doc.title, headings, fields, grids };
  }).filter((f) => f.fields.length || f.grids.length || f.headings.length);

  return { capturedAt: new Date().toISOString(), topUrl: location.href, frames };
})();
