/* Table detector: semantic <table> and ARIA grids. (Div-grids via repetition: Phase 3.) */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const NUM_RE = /^[\s$€£¥]*-?[\d.,]+\s?%?\s?[A-Za-z%$€£]{0,3}$/;

  function rowsOfTable(snap, t) {
    const head = [], body = [];
    (function rec(n, inHead) {
      for (const cid of n.children) {
        const c = snap.nodes[cid];
        if (c.tag === 'TABLE') continue;
        if (c.tag === 'TR') (inHead ? head : body).push(c.children.map((x) => snap.nodes[x]).filter((x) => x.tag === 'TD' || x.tag === 'TH'));
        else rec(c, inHead || c.tag === 'THEAD');
      }
    })(t, false);
    return { head, body };
  }
  function rowsOfGrid(snap, g) {
    const rows = [];
    L.walk(snap, g.id, (n) => {
      if (n !== g && n.role === 'row') { rows.push(n.children.map((x) => snap.nodes[x]).filter((x) => /^(cell|gridcell|columnheader|rowheader)$/.test(x.role))); return false; }
    });
    return { head: [], body: rows };
  }

  /** Public so output + tests can reuse: returns {headers, rows, headerSource} */
  function extractTable(snap, node) {
    let { head, body } = node.tag === 'TABLE' ? rowsOfTable(snap, node) : rowsOfGrid(snap, node);
    const txt = (c) => L.textOf(snap, c.id);
    let headerCells = null, source = 'generated';
    if (head.length) { headerCells = head[head.length - 1]; source = 'thead'; }
    else if (body.length && body[0].length && body[0].every((c) => c.tag === 'TH' || c.role === 'columnheader')) { headerCells = body.shift(); source = 'th-row'; }
    else if (body.length > 2 && body[0].length) {
      const first = body[0].map(txt), numericBelow = body[0].some((_, i) => body.slice(1, 6).some((r) => r[i] && NUM_RE.test(txt(r[i]))));
      if (first.every((t) => t && !NUM_RE.test(t)) && numericBelow) { headerCells = body.shift(); source = 'inferred'; }
    }
    const expand = (cells) => { const out = []; for (const c of cells) { out.push(txt(c)); const span = parseInt(c.el.getAttribute('colspan') || '1', 10); for (let i = 1; i < (span > 1 && span < 50 ? span : 1); i++) out.push(''); } return out; };
    const rows = body.map(expand);
    const width = Math.max(headerCells ? expand(headerCells).length : 0, ...rows.map((r) => r.length), 0);
    const headers = headerCells ? expand(headerCells) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
    while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
    return { headers, rows: rows.map((r) => { const o = r.slice(); while (o.length < width) o.push(''); return o; }), headerSource: source };
  }
  L.extractTable = extractTable;

  L.registerDetector({
    id: 'table', kinds: ['table'],
    detect(ctx) {
      const { snap } = ctx, out = [];
      for (const n of snap.nodes) {
        const isTable = n.tag === 'TABLE', isGrid = !isTable && (n.role === 'grid' || n.role === 'table');
        if (!isTable && !isGrid) continue;
        if (n.role === 'presentation' || n.role === 'none') continue;
        const t = extractTable(snap, n);
        const cols = t.headers.length, rows = t.rows.length;
        if (rows < 2 || cols < 2) continue;
        const modal = (() => { const m = new Map(); for (const r of t.rows) m.set(r.filter(Boolean).length, (m.get(r.filter(Boolean).length) || 0) + 1); return Math.max(...m.values()) / rows; })();
        const cells = t.rows.flat(), nonEmpty = cells.filter(Boolean).length / Math.max(1, cells.length);
        const numeric = cells.filter((c) => NUM_RE.test(c)).length / Math.max(1, cells.length);
        const ev = [
          u.sig('base', .10, 1, 'prior'),
          u.sig('header', .25, t.headerSource === 'thead' || t.headerSource === 'th-row' ? 1 : t.headerSource === 'inferred' ? .5 : 0, `header: ${t.headerSource}`),
          u.sig('consistency', .20, modal, 'rows with the modal cell count'),
          u.sig('size', .15, u.clamp(rows / 8), `${rows} rows x ${cols} cols`),
          u.sig('filled', .10, nonEmpty, 'non-empty cells'),
          u.sig('numeric', .10, u.clamp(numeric * 2), 'numeric cell share'),
          u.sig('caption', .05, n.children.some((c) => snap.nodes[c].tag === 'CAPTION') ? 1 : 0, 'caption'),
          u.sig('semantic', .05, isTable ? 1 : .5, isTable ? '<table>' : 'ARIA grid'),
          u.sig('nested', -.30, n.stats.tableCount > 1 ? 1 : 0, 'contains nested tables (layout smell)'),
          u.sig('boilerplate', -.40, n.bp, 'boilerplate ancestry'),
        ];
        const score = u.round2(u.clamp(ev.reduce((a, e) => a + e.weight * e.value, 0)));
        out.push({ detectorId: 'table', kind: 'table', nodeId: n.id, score, evidence: ev, hints: { rows, cols, headers: t.headers.slice(0, 12), headerSource: t.headerSource } });
      }
      return out;
    },
  });
})();
