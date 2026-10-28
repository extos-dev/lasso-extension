/* Inspect: per-tab session state, live tree serialisation and scoped patterns.
 * This file is classic-script layer 3: it may use snapshot/segment/detectors but
 * never extension APIs. The overlay and bridge drive it; the panel only sees messages.
 * Node ids are per session and die with stop()/navigation, as the charter requires. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const MIN_ARTICLE_PROSE = 200;
  const MAX_CHILDREN = 400;
  const PATTERN_ID = /^[a-z][a-z0-9_-]{1,24}$/;
  const state = { active: false, snap: null, startedAt: 0, selectedId: null, lastResult: null, stats: null, detectedFor: null, detectedPatterns: [], detectedResults: [] };
  const registry = new Map();

  const get = (id) => (state.snap ? state.snap.nodes[id] : null);
  const parentOf = (n) => (n && n.parentId !== null ? get(n.parentId) : null);
  const prose = (n) => n.stats.textLength - n.stats.linkTextLength;

  /** Tree/overlay label. Hashed (CSS-in-JS) classes are dropped, so the badge and the
   *  tree row always read the same. Exported for the overlay as nodeLabel. */
  function label(n) {
    if (!n) return '';
    const toks = u.stableTokens(n.cls || '');
    return n.tag.toLowerCase() + (n.el && n.el.id ? '#' + n.el.id : '') + (toks.length ? '.' + toks[0] : '');
  }

  function directText(n) {
    const s = n.parts.filter((p) => typeof p === 'string').join(' ');
    return u.collapse(s).trim().slice(0, 90);
  }

  function serialize(n) {
    return {
      id: n.id, parentId: n.parentId, tag: n.tag, role: n.role || '', label: label(n), preview: directText(n),
      depth: n.depth, childCount: n.children.length, textLength: n.stats.textLength,
      wordCount: n.stats.wordCount, linkCount: n.stats.linkCount, bp: u.round2(n.bp),
    };
  }

  function selectedInfo(n) {
    return { ...serialize(n), text: L.textOf(state.snap, n.id).slice(0, 500) };
  }

  function breadcrumb(id) {
    const out = [];
    let n = get(id);
    while (n) { out.push({ id: n.id, label: label(n), tag: n.tag }); n = parentOf(n); }
    return out.reverse();
  }

  function stats() {
    return state.stats ? { ...state.stats, active: state.active } : null;
  }

  function info() {
    if (!state.active || !state.snap) return { active: false, stats: null, selected: null, selectedId: null, breadcrumb: [], patterns: [], patternsReady: false, root: null, rootChildren: [], lastResult: null, results: [], catalog: catalog() };
    const root = state.snap.root ? serialize(state.snap.root) : null;
    const sel = state.selectedId !== null ? get(state.selectedId) : null;
    return {
      active: true, url: state.snap.url, title: state.snap.meta ? state.snap.meta.title : '',
      root, rootChildren: root ? childrenOf(root.id).children : [],
      selectedId: state.selectedId, selected: sel ? selectedInfo(sel) : null,
      breadcrumb: sel ? breadcrumb(sel.id) : [],
      patterns: sel && state.detectedFor === sel.id ? state.detectedPatterns : [],
      patternsReady: !!(sel && state.detectedFor === sel.id),
      results: sel && state.detectedFor === sel.id ? state.detectedResults : [],
      catalog: catalog(),
      lastResult: state.lastResult, stats: stats(),
    };
  }

  function childrenOf(id) {
    const n = get(id);
    if (!n) return { nodeId: id, children: [], total: 0, truncated: false };
    const ids = n.children.slice(0, MAX_CHILDREN);
    return { nodeId: id, children: ids.map((cid) => serialize(get(cid))), total: n.children.length, truncated: ids.length < n.children.length };
  }

  function nodeAt(el) {
    if (!state.active || !state.snap) return null;
    let e = el;
    while (e && e.nodeType === 1) {
      const n = state.snap.byEl.get(e);
      if (n) return n;
      e = e.parentElement;
    }
    return null;
  }

  function bestDescendant(start, pred) {
    let best = null;
    L.walk(state.snap, start.id, (n) => {
      if (n !== start && pred(n) && (!best || n.stats.textLength > best.stats.textLength)) best = n;
    });
    return best;
  }

  function articleFor(startId, opts = {}) {
    const start = get(startId);
    if (!start) return { ok: false, reason: 'element not found' };
    let target = null;
    // An <article> ancestor genuinely contains the selection, so climbing to it
    // is in scope. <main> is only a page wrapper: never climb to it.
    for (let p = start; p; p = parentOf(p)) {
      if (p.tag === 'ARTICLE' || p.role === 'article') { target = p; break; }
    }
    if (!target) {
      if (!opts.scoped) {
        target = bestDescendant(start, (n) => n.tag === 'ARTICLE' || n.role === 'article') || start;
      } else {
        target = start;
      }
    }
    const pr = prose(target);
    const h = L.articleHints ? L.articleHints(state.snap, target, { scoped: true }) : {};
    const title = h.title ? ` · ${h.title}` : '';
    const minProse = opts.scoped ? 100 : MIN_ARTICLE_PROSE;
    return { ok: pr >= minProse, nodeId: target.id, reason: `${pr} chars of prose${title}`, meta: { wordCount: target.stats.wordCount, title: h.title || '' } };
  }

  function tableFor(startId, opts = {}) {
    const start = get(startId);
    if (!start) return { ok: false, reason: 'element not found' };
    let target = null;
    for (let p = start; p; p = parentOf(p)) {
      if (p.tag === 'TABLE' || p.role === 'grid' || p.role === 'table') { target = p; break; }
    }
    if (!target) target = bestDescendant(start, (n) => n.tag === 'TABLE' || n.role === 'grid' || n.role === 'table');
    if (!target) return { ok: false, reason: 'no table in this selection' };
    if (target.role === 'presentation' || target.role === 'none') return { ok: false, reason: 'presentation table' };
    let t;
    try { t = L.extractTable(state.snap, target); } catch (_) { return { ok: false, reason: 'table could not be read' }; }
    const minRows = opts.scoped ? 1 : 2;
    const minCols = opts.scoped ? 1 : 2;
    if (!t || t.rows.length < minRows || t.headers.length < minCols) return { ok: false, reason: `needs at least ${minRows} row(s) and ${minCols} column(s)` };
    return { ok: true, nodeId: target.id, reason: `${t.rows.length} rows × ${t.headers.length} cols`, meta: { rows: t.rows.length, cols: t.headers.length } };
  }

  function listFor(startId, opts = {}) {
    const start = get(startId);
    if (!start) return { ok: false, reason: 'element not found' };
    const seen = new Set(), groups = [];
    const tryParent = (p, force = false) => {
      if (!p || seen.has(p.id)) return;
      seen.add(p.id);
      // Try with lower threshold in scoped/forced mode
      const g = L.segment.groupForParent(state.snap, p, force ? 2 : 3);
      if (g) groups.push({ ...g, forced: force });
    };
    // Try the start and its immediate parents
    let p = start;
    for (let i = 0; i < 4 && p; i++) { tryParent(p, opts.scoped || i === 0); p = parentOf(p); }
    let walked = 0;
    L.walk(state.snap, start.id, (n) => {
      if (walked++ > 500) return false;
      if (n !== start && n.children.length >= (opts.scoped ? 2 : 3)) tryParent(n, opts.scoped);
    });
    if (!groups.length) return { ok: false, reason: 'no repeated items in this selection' };
    const rank = (g) => {
      const rich = Math.max(g.fields.link, g.fields.image, g.fields.heading);
      let score = g.itemIds.length * 2 + g.ratio * 2 + rich * 2;
      if (g.parentId === start.id) score += 3; // prefer exact selection
      if (g.forced) score += 1;
      return score;
    };
    groups.sort((a, b) => rank(b) - rank(a));
    const g = groups[0], parent = get(g.parentId);
    const rich = Math.max(g.fields.link, g.fields.image, g.fields.heading, g.fields.price, g.fields.date);
    const listTag = parent && (parent.tag === 'UL' || parent.tag === 'OL' || parent.tag === 'DL');
    const minItems = opts.scoped ? 2 : 3;
    const minRich = opts.scoped ? 0.3 : 0.5;
    const minText = opts.scoped ? 2 : 10;
    if (!listTag && rich < minRich && !opts.scoped) return { ok: false, reason: 'items have no link, image, heading, price or date' };
    if (g.itemIds.length < minItems || g.avgText < minText) return { ok: false, reason: 'not enough repeated content' };
    // For scoped mode, be more permissive about nav-like (chat history is link-heavy nav)
    if (!opts.scoped) {
      const navLike = g.avgLinkDensity > .85 && g.avgText < 45 && f.image < .3;
      if (navLike) return { ok: false, reason: 'looks like navigation' };
    }
    const flavor = g.fields.price >= .5 ? 'product' : g.fields.date >= .5 && g.fields.heading >= .5 ? 'post' : g.fields.link >= .6 && g.fields.heading >= .5 ? 'result' : 'generic';
    return { ok: true, nodeId: g.parentId, itemIds: g.itemIds.slice(), reason: `${g.itemIds.length} items`, meta: { count: g.itemIds.length, flavor, scoped: opts.scoped } };
  }

  function textFor(startId) {
    const n = get(startId);
    if (!n) return { ok: false, reason: 'element not found' };
    const text = L.textOf(state.snap, n.id);
    return { ok: !!text, nodeId: n.id, reason: `${text.length} chars`, meta: { chars: text.length } };
  }

  /** Extension point: add an inspect pattern (loaded after this file, layer 3). */
  function registerPattern(def) {
    if (!def || !PATTERN_ID.test(def.id || '')) throw new Error('Pattern needs a lowercase id');
    if (typeof def.detect !== 'function') throw new Error('Pattern ' + def.id + ' needs detect()');
    registry.set(def.id, {
      id: def.id, label: def.label || def.id, order: Number.isFinite(def.order) ? def.order : 100,
      detect: def.detect, build: typeof def.build === 'function' ? def.build : null,
    });
    return def.id;
  }
  const patternDefs = () => [...registry.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
  const catalog = () => patternDefs().map((d) => ({ id: d.id, label: d.label, order: d.order }));

  /** The single wording for a built result — the panel, the Map and the overlay all use
   *  this one, so the same selection can never be described two different ways. */
  function resultSummary(result) {
    if (!result) return '';
    const n = (v) => (v || 0).toLocaleString();
    const count = (v, one, many) => `${n(v)} ${v === 1 ? one : many}`;
    switch (result.kind) {
      case 'article': return count(result.wordCount, 'word', 'words');
      case 'table': return `${n(result.rows)} rows × ${n(result.cols)} cols`;
      case 'record_list': return `${n(result.count)} items${result.flavor ? ` · ${result.flavor}` : ''}`;
      case 'chat': return count(result.count, 'message', 'messages');
      case 'contact': return `${count((result.emails || []).length, 'email', 'emails')} · ${count((result.phones || []).length, 'phone', 'phones')}`;
      case 'text': return `${n(result.chars)} chars`;
      default: return result.label || '';
    }
  }

  function start() {
    if (state.active) return info();
    const snap = L.snapshot(document, { maxNodes: 25000 });
    if (!snap.root) throw new Error('No visible page body to inspect');
    state.snap = snap;
    state.active = true;
    state.startedAt = Date.now();
    state.selectedId = null;
    state.lastResult = null;
    state.detectedFor = null;
    state.detectedPatterns = [];
    state.detectedResults = [];
    state.stats = {
      startedAt: state.startedAt, nodes: snap.nodes.length, snapshotMs: snap.ms,
      truncated: snap.truncated, hiddenSkipped: snap.hiddenSkipped,
      selections: 0, patternsApplied: 0, lastPattern: null,
    };
    return info();
  }

  function stop() {
    state.active = false;
    state.snap = null;
    state.startedAt = 0;
    state.selectedId = null;
    state.lastResult = null;
    state.detectedFor = null;
    state.detectedPatterns = [];
    state.detectedResults = [];
    state.stats = null;
    return { active: false, stats: null, selected: null, selectedId: null, breadcrumb: [], patterns: [], patternsReady: false, root: null, rootChildren: [], lastResult: null, results: [], catalog: catalog() };
  }

  function select(id) {
    const n = get(id);
    if (!n) throw new Error('That element is no longer in the page snapshot');
    if (state.selectedId !== id) {
      state.stats.selections += 1;
      state.detectedFor = null;
      state.detectedPatterns = [];
      state.detectedResults = [];
      state.lastResult = null;
    }
    state.selectedId = id;
    const ready = state.detectedFor === id;
    return {
      selectedId: id, selected: selectedInfo(n), breadcrumb: breadcrumb(id),
      patterns: ready ? state.detectedPatterns : [], patternsReady: ready,
      results: ready ? state.detectedResults : [], catalog: catalog(), stats: stats(),
    };
  }

  // Explicit user action: run only the chosen patterns against the selected
  // region, build each result, and cache the result list for the menu/panel.
  function detectPatterns(id, requested, opts = {}) {
    const n = get(id);
    if (!n) throw new Error('That element is no longer in the page snapshot');
    const wanted = Array.isArray(requested) ? new Set(requested) : new Set(['text']);
    const selected = patternDefs().filter((d) => wanted.has(d.id));
    const results = selected.map((def) => {
      let r;
      try { 
        // Pass options to detect if it accepts them
        if (def.id === 'list' || def.id === 'article' || def.id === 'table') {
          r = def.detect(id, opts);
        } else {
          r = def.detect(id); 
        }
      } catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
      if (!r.ok) return { pattern: def.id, label: def.label, ok: false, reason: r.reason || 'not applicable', summary: r.reason || 'not applicable', result: null };
      if (!def.build) return { pattern: def.id, label: def.label, ok: false, reason: 'no builder', summary: 'no builder', result: null };
      try {
        const result = { pattern: def.id, ...def.build(r, id) };
        if (!result.label) result.label = label(get(result.nodeId));
        return { pattern: def.id, label: def.label, ok: true, reason: r.reason || '', summary: resultSummary(result), result };
      } catch (e) {
        const reason = String((e && e.message) || e);
        return { pattern: def.id, label: def.label, ok: false, reason, summary: reason, result: null };
      }
    });
    state.detectedFor = id;
    state.detectedPatterns = results.map((r) => ({ id: r.pattern, label: r.label, applicable: r.ok, reason: r.reason, meta: null }));
    state.detectedResults = results;
    state.lastResult = results.length === 1 && results[0].ok ? results[0].result : null;
    const applied = results.filter((r) => r.ok);
    if (state.stats) {
      state.stats.patternsApplied += applied.length;
      state.stats.lastPattern = applied.length ? applied[applied.length - 1].pattern : null;
    }
    return {
      selectedId: id, selected: selectedInfo(n), breadcrumb: breadcrumb(id),
      patterns: state.detectedPatterns, patternsReady: true, results, catalog: catalog(),
      lastResult: state.lastResult, stats: stats(),
    };
  }

  function scanAll(requested) {
    if (!state.active || !state.snap) {
      try { start(); } catch (e) { throw e; }
    }
    if (!state.active || !state.snap) throw new Error('No visible page body to inspect');
    const wanted = Array.isArray(requested) && requested.length ? new Set(requested) : null;
    const defs = patternDefs().filter((d) => !wanted || wanted.has(d.id));
    const snap = state.snap;
    const seen = new Set();
    const candidates = [];
    if (snap.root) candidates.push(snap.root.id);
    // Prefer common containers and also add broad set
    try {
      L.walk(snap, snap.root.id, (n) => {
        if (candidates.length > 200) return false;
        const t = n.tag;
        if (t === 'ARTICLE' || n.role === 'article' || t === 'MAIN' || n.role === 'main' || t === 'SECTION') {
          if (!candidates.includes(n.id)) candidates.push(n.id);
        } else if (t === 'TABLE' || n.role === 'grid' || n.role === 'table') {
          if (!candidates.includes(n.id)) candidates.push(n.id);
        } else if (n.children && n.children.length >= 3) {
          try {
            const g = L.segment && typeof L.segment.groupForParent === 'function' ? L.segment.groupForParent(snap, n) : null;
            if (g && g.itemIds && g.itemIds.length >= 3) {
              if (!candidates.includes(n.id)) candidates.push(n.id);
            }
          } catch (_) {}
        } else if (n.stats && (n.stats.textLength > 200 || n.stats.paragraphCount > 0)) {
          if (candidates.length < 120 && !candidates.includes(n.id)) candidates.push(n.id);
        }
      });
    } catch (_) { /* best effort */ }

    const results = [];
    for (const def of defs) {
      for (const cid of candidates) {
        const key = def.id + '|' + cid;
        if (seen.has(key)) continue;
        let r;
        try { r = def.detect(cid); } catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
        if (!r.ok) continue;
        if (!def.build) continue;
        try {
          const res = { pattern: def.id, ...def.build(r, cid) };
          const node = get(res.nodeId);
          if (!res.label && node) res.label = label(node);
          results.push({ pattern: def.id, label: def.label, ok: true, reason: r.reason || '', summary: resultSummary(res), result: res });
          seen.add(key);
        } catch (e) {
          /* skip bad builds */
        }
      }
    }

    // Deduplicate by pattern+kind+nodeId+summary where sensible
    const out = [];
    const dkey = new Set();
    for (const it of results) {
      const kk = it.pattern + '::' + (it.result && it.result.kind) + '::' + (it.result && it.result.nodeId);
      if (dkey.has(kk)) continue;
      dkey.add(kk);
      out.push(it);
    }

    // Sort: article/table/list first, then others by order
    const order = { article: 0, table: 1, record_list: 2, chat: 3, contact: 4, text: 5 };
    out.sort((a, b) => {
      const ka = a.result && a.result.kind ? order[a.result.kind] : 99;
      const kb = b.result && b.result.kind ? order[b.result.kind] : 99;
      if (ka !== kb) return ka - kb;
      return (a.label || '').localeCompare(b.label || '');
    });

    if (state.stats) {
      const applied = out.filter((r) => r.ok);
      state.stats.patternsApplied += applied.length;
      if (applied.length) state.stats.lastPattern = applied[applied.length - 1].pattern;
    }

    return { results: out, catalog: catalog(), stats: stats() };
  }

  L.inspect = {
    start, stop, select, detectPatterns, scanAll, info, childrenOf, nodeAt,
    snapshot: () => state.snap, lastResult: () => state.lastResult,
    detectedResults: () => state.detectedResults.slice(), catalog,
    selectedId: () => state.selectedId, isActive: () => state.active,
    summary: resultSummary, nodeLabel: label,
    registerPattern, patternDefs: () => catalog(),
    getPattern: (id) => registry.get(id),
    _registry: () => registry,
  };

  registerPattern({ id: 'article', label: 'Article', order: 10, detect: (id, opts) => articleFor(id, opts), build: (r) => ({ kind: 'article', nodeId: r.nodeId, wordCount: r.meta.wordCount, title: r.meta.title || '' }) });
  registerPattern({ id: 'table', label: 'Table', order: 20, detect: (id, opts) => tableFor(id, opts), build: (r) => ({ kind: 'table', nodeId: r.nodeId, rows: r.meta.rows, cols: r.meta.cols }) });
  registerPattern({ id: 'list', label: 'List', order: 30, detect: (id, opts) => listFor(id, opts), build: (r) => ({ kind: 'record_list', nodeId: r.nodeId, itemIds: r.itemIds, count: r.meta.count, flavor: r.meta.flavor }) });
  registerPattern({ id: 'text', label: 'Text', order: 90, detect: textFor, build: (r) => ({ kind: 'text', nodeId: r.nodeId, chars: r.meta.chars }) });
})();
