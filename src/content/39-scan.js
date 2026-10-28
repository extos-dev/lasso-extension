/* Unified scan: centralized pattern detection with explicit scope.
 * All auto-detection flows through here. Takes a parent node (root for whole page
 * or any specific node) and runs selected patterns only within that subtree.
 * Results are returned in-place for the Page tab. */
(() => {
  const L = globalThis.Lasso, u = L.util;
  const state = { scopeId: null };
  const PATTERN_ID = /^[a-z][a-z0-9_-]{1,24}$/;

  const get = (snap, id) => (snap && snap.nodes ? snap.nodes[id] : null);

  function ensureSnap() {
    if (L.inspect && L.inspect.snapshot && L.inspect.snapshot()) return L.inspect.snapshot();
    // Try to get from global state or create fresh
    if (state._snap) return state._snap;
    return null;
  }

  function setScope(nodeId) {
    state.scopeId = nodeId === undefined || nodeId === null ? null : nodeId;
    return { ok: true, scopeId: state.scopeId };
  }

  function getScope() {
    return { scopeId: state.scopeId };
  }

  function clearScope() {
    state.scopeId = null;
    return { ok: true, scopeId: null };
  }

  function run(opts = {}) {
    const snap = L.inspect && L.inspect.snapshot ? L.inspect.snapshot() : state._snap;
    if (!snap) {
      try {
        if (L.inspect && typeof L.inspect.start === 'function') {
          const info = L.inspect.start();
          // start() sets internal state
        }
      } catch (_) {}
    }
    const s = L.inspect && L.inspect.snapshot ? L.inspect.snapshot() : snap;
    if (!s) throw new Error('No snapshot available - start inspect or ensure page is mapped');

    const rootId = state.scopeId !== null && state.scopeId !== undefined ? state.scopeId : (s.root ? s.root.id : null);
    const parent = rootId !== null ? get(s, rootId) : s.root;
    if (!parent && rootId === null) throw new Error('No parent node to scan');

    const requested = Array.isArray(opts.patterns) ? new Set(opts.patterns) : null;
    const defs = [];
    if (L.inspect && typeof L.inspect.patternDefs === 'function') {
      // get registered patterns
    }
    // Get from registry
    if (L.inspect && L.inspect.catalog) {
      const cat = L.inspect.catalog();
      for (const c of cat) {
        if (requested && !requested.has(c.id)) continue;
        defs.push(c);
      }
    } else {
      // fallback
      defs.push({ id: 'text', label: 'Text' });
    }

    // Also check registry directly if accessible
    const results = [];
    const registry = L.inspect && L.inspect._registry ? L.inspect._registry() : null;
    
    for (const def of defs) {
      const did = def.id;
      // Get pattern def
      let patDef = null;
      if (L.inspect && L.inspect.getPattern) {
        patDef = L.inspect.getPattern(did);
      }
      // Try to access internal registry
      if (!patDef && registry) {
        patDef = registry.get ? registry.get(did) : registry[did];
      }
      if (!patDef) {
        // fallback to built-ins
        if (did === 'text') {
          try {
            const r = { ok: !!L.textOf(s, rootId), nodeId: rootId, reason: `${(L.textOf(s, rootId) || '').length} chars`, meta: { chars: (L.textOf(s, rootId) || '').length } };
            if (r.ok) {
              const res = { pattern: did, kind: 'text', nodeId: r.nodeId, chars: r.meta.chars };
              results.push({ pattern: did, label: def.label || 'Text', ok: true, reason: r.reason, summary: L.inspect.summary ? L.inspect.summary(res) : r.reason, result: res });
            } else {
              results.push({ pattern: did, label: def.label || 'Text', ok: false, reason: r.reason || 'not applicable', summary: r.reason || 'not applicable', result: null });
            }
          } catch (e) {
            results.push({ pattern: did, label: def.label || 'Text', ok: false, reason: e.message, summary: e.message, result: null });
          }
        }
        continue;
      }
      try {
        // Pass scoped true when scanning a specific scope
        let r;
        if (typeof patDef.detect === 'function') {
          try {
            r = patDef.detect(rootId, { scoped: state.scopeId !== null });
          } catch (_) {
            try { r = patDef.detect(rootId); } catch (e2) { r = { ok: false, reason: e2.message }; }
          }
        } else {
          r = { ok: false, reason: 'no detect' };
        }
        if (!r || !r.ok) {
          results.push({ pattern: did, label: patDef.label || def.label || did, ok: false, reason: r && r.reason || 'not applicable', summary: r && r.reason || 'not applicable', result: null });
          continue;
        }
        if (typeof patDef.build === 'function') {
          try {
            const result = { pattern: did, ...patDef.build(r, rootId) };
            if (!result.label && get(s, result.nodeId)) {
              if (L.inspect && L.inspect.nodeLabel) result.label = L.inspect.nodeLabel(get(s, result.nodeId));
            }
            const summary = L.inspect && L.inspect.summary ? L.inspect.summary(result) : (r.reason || '');
            results.push({ pattern: did, label: patDef.label || def.label || did, ok: true, reason: r.reason || '', summary, result });
          } catch (e) {
            results.push({ pattern: did, label: patDef.label || def.label || did, ok: false, reason: e.message, summary: e.message, result: null });
          }
        } else {
          results.push({ pattern: did, label: patDef.label || def.label || did, ok: false, reason: 'no builder', summary: 'no builder', result: null });
        }
      } catch (e) {
        results.push({ pattern: did, label: patDef.label || def.label || did, ok: false, reason: e.message, summary: e.message, result: null });
      }
    }

    // Sort like before
    const order = { article: 0, table: 1, record_list: 2, chat: 3, contact: 4, text: 5 };
    results.sort((a, b) => {
      const ka = a.result && a.result.kind ? order[a.result.kind] : 99;
      const kb = b.result && b.result.kind ? order[b.result.kind] : 99;
      if (ka !== kb) return ka - kb;
      return (a.label || '').localeCompare(b.label || '');
    });

    return { results, scopeId: rootId, catalog: (L.inspect && L.inspect.catalog) ? L.inspect.catalog() : defs };
  }

  L.scan = { run, setScope, getScope, clearScope, _state: state };
})();
